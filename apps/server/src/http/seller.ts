import {
  orderPatch,
  paymentInput,
  pendingDecision,
  productPatch,
  sellerMessage,
  shopPatch,
  variantAdjust,
} from '@saudaai/shared'
import { and, desc, eq, gte, inArray, like, ne, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Deps } from '../agent/deps.ts'
import { conversationById, sendToCustomer } from '../agent/messaging.ts'
import { approve, cancel } from '../agent/pending.ts'
import { asSeller, toolByName, type TurnCtx } from '../agent/registry.ts'
import { newId } from '../db/ids.ts'
import {
  activityLog,
  conversations,
  customers,
  messages,
  modelCalls,
  orderStatuses,
  payments,
  pendingActions,
  products,
  shops,
} from '../db/schema.ts'
import { invoicePdf } from '../render/invoice.ts'
import type { Ctx, Shop } from '../tools/ctx.ts'
import { customerView, requireCustomer } from '../tools/customers.ts'
import { getOrder, listOrders, recordPayment, updateOrderStatus } from '../tools/orders.ts'
import { adjustStock, getProduct, loadVariants, updateProduct } from '../tools/products.ts'
import { dailySummary, salesReport } from '../tools/reports.ts'
import { dhakaDayStart } from '../tools/text.ts'
import { body } from './body.ts'
import type { SellerEnv } from './session.ts'

export function sellerRoutes(deps: Deps) {
  const app = new Hono<SellerEnv>()
  const { db } = deps
  const ctx = (shop: Shop): Ctx => ({ db, shop, actor: 'seller', now: deps.now() })
  const turn = (shop: Shop): TurnCtx => ({
    ...ctx(shop),
    deps,
    conversation: null,
    turnId: `web_${newId()}`,
    inputKind: 'text',
  })
  const conversationOf = async (shop: Shop, id: string) => {
    const conv = await conversationById(deps, id)
    if (!conv || conv.shopId !== shop.id)
      throw new HTTPException(404, { message: 'chat not found' })
    return conv
  }

  app.get('/me', async (c) => {
    const shop = c.get('shop')
    return c.json({
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      area: shop.area,
      ownerName: shop.ownerName,
      deliveryRules: shop.deliveryRules,
      paymentMethods: shop.paymentMethods,
      bkashNumber: shop.bkashNumber,
      auto: shop.auto,
      feedMuted: shop.feedMuted,
      telegramLinked: Boolean(shop.telegramChatId),
      linkCode: c.get('readonly') ? null : shop.linkCode,
      readonly: c.get('readonly'),
    })
  })

  app.patch('/shop', async (c) => {
    const shop = c.get('shop')
    const p = await body(c, shopPatch)
    const rules = shop.deliveryRules
    const auto = { ...shop.auto }
    if (p.autoConfirmUpToTaka !== undefined) {
      if (p.autoConfirmUpToTaka === null) delete auto.confirm_order
      else auto.confirm_order = { maxPoisha: p.autoConfirmUpToTaka * 100 }
    }
    if (p.autoSendConfirmation !== undefined) auto.send_order_confirmation = p.autoSendConfirmation
    if (p.autoSendReminders !== undefined) auto.send_payment_reminder = p.autoSendReminders
    await db
      .update(shops)
      .set({
        name: p.name ?? shop.name,
        area: p.area ?? shop.area,
        bkashNumber: p.bkashNumber === undefined ? shop.bkashNumber : p.bkashNumber,
        paymentMethods: p.paymentMethods ?? shop.paymentMethods,
        deliveryRules: {
          ...rules,
          insideDhakaPoisha:
            p.insideDhakaTaka !== undefined ? p.insideDhakaTaka * 100 : rules.insideDhakaPoisha,
          outsideDhakaPoisha:
            p.outsideDhakaTaka !== undefined ? p.outsideDhakaTaka * 100 : rules.outsideDhakaPoisha,
        },
        auto,
        feedMuted: p.feedMuted ?? shop.feedMuted,
      })
      .where(eq(shops.id, shop.id))
    return c.json({ ok: true })
  })

  app.get('/dashboard', async (c) => {
    const shop = c.get('shop')
    const [summary, pending, recent, usage] = await Promise.all([
      dailySummary(ctx(shop)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(pendingActions)
        .where(and(eq(pendingActions.shopId, shop.id), eq(pendingActions.status, 'pending'))),
      listOrders(ctx(shop), { limit: 8 }),
      db
        .select({
          purpose: modelCalls.purpose,
          calls: sql<number>`count(*)`,
          cached: sql<number>`sum(${modelCalls.cacheHit})`,
        })
        .from(modelCalls)
        .where(gte(modelCalls.createdAt, dhakaDayStart(deps.now())))
        .groupBy(modelCalls.purpose),
    ])
    return c.json({ summary, pending: Number(pending[0]?.n ?? 0), recent, usage })
  })

  app.get('/orders', async (c) => {
    const status = c.req.query('status')
    const q = c.req.query('q')?.trim().toLowerCase()
    const list = await listOrders(ctx(c.get('shop')), {
      status: status
        ? (status
            .split(',')
            .filter((s) => (orderStatuses as readonly string[]).includes(s)) as never)
        : undefined,
      limit: q ? 200 : 50,
      offset: Number(c.req.query('offset') ?? 0),
    })
    const filtered = q
      ? list.filter((o) => String(o.number).includes(q) || o.customer.toLowerCase().includes(q))
      : list
    return c.json({ orders: filtered.slice(0, 50) })
  })

  app.get('/orders/:id', async (c) => {
    const order = await getOrder(ctx(c.get('shop')), { orderId: c.req.param('id') })
    const paid = await db.select().from(payments).where(eq(payments.orderId, order.orderId))
    return c.json({ order, payments: paid })
  })

  app.patch('/orders/:id', async (c) => {
    const shop = c.get('shop')
    const { status } = await body(c, orderPatch)
    const orderId = c.req.param('id')
    if (status === 'confirmed') {
      const result = await toolByName
        .get('send_order_confirmation')!
        .run(asSeller(turn(shop)), { orderId } as never)
      return c.json(result)
    }
    return c.json(await updateOrderStatus(ctx(shop), { orderId, status }))
  })

  app.post('/orders/:id/payments', async (c) => {
    const p = await body(c, paymentInput)
    return c.json(
      await recordPayment(ctx(c.get('shop')), {
        orderId: c.req.param('id'),
        amountPoisha: p.amountTaka * 100,
        method: p.method,
      }),
    )
  })

  app.get('/orders/:id/invoice.pdf', async (c) => {
    const shop = c.get('shop')
    const order = await getOrder(ctx(shop), { orderId: c.req.param('id') })
    const file = await invoicePdf(db, shop, order.orderId)
    return c.body(new Uint8Array(file), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="invoice-${order.number}.pdf"`,
    })
  })

  app.get('/products', async (c) => {
    const shop = c.get('shop')
    const q = c.req.query('q')?.trim()
    const status = c.req.query('status')
    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.shopId, shop.id),
          status ? eq(products.status, status as 'active') : ne(products.status, 'archived'),
          q ? like(products.name, `%${q}%`) : undefined,
        ),
      )
      .orderBy(desc(products.createdAt))
    const byProduct = await loadVariants(
      ctx(shop),
      rows.map((p) => p.id),
    )
    return c.json({
      products: rows.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        pricePoisha: p.basePricePoisha,
        imageUrl: p.imageId ? `/media/${p.imageId}` : null,
        variants: (byProduct.get(p.id) ?? []).map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          pricePoisha: v.pricePoisha,
          stock: v.stock,
          reserved: v.reserved,
        })),
      })),
    })
  })

  app.get('/products/:id', async (c) =>
    c.json(await getProduct(ctx(c.get('shop')), { productId: c.req.param('id') })),
  )

  app.patch('/products/:id', async (c) => {
    const p = await body(c, productPatch)
    return c.json(
      await updateProduct(ctx(c.get('shop')), {
        productId: c.req.param('id'),
        name: p.name,
        status: p.status,
        pricePoisha: p.priceTaka !== undefined ? p.priceTaka * 100 : undefined,
      }),
    )
  })

  app.patch('/variants/:id', async (c) => {
    const p = await body(c, variantAdjust)
    return c.json(await adjustStock(ctx(c.get('shop')), { variantId: c.req.param('id'), ...p }))
  })

  app.get('/customers', async (c) => {
    const shop = c.get('shop')
    const q = c.req.query('q')?.trim()
    const rows = await db
      .select({
        c: customers,
        orders: sql<number>`(select count(*) from orders o where o.customer_id = ${customers.id} and o.status != 'cancelled')`,
        duePoisha: sql<number>`(select coalesce(sum(o.total_poisha - o.paid_poisha), 0) from orders o where o.customer_id = ${customers.id} and o.status in ('confirmed', 'shipped', 'delivered'))`,
      })
      .from(customers)
      .where(
        and(
          eq(customers.shopId, shop.id),
          q ? or(like(customers.name, `%${q}%`), like(customers.phone, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(customers.createdAt))
      .limit(100)
    return c.json({
      customers: rows.map((r) => ({
        ...customerView(r.c),
        orders: Number(r.orders),
        duePoisha: Number(r.duePoisha),
      })),
    })
  })

  app.get('/customers/:id', async (c) => {
    const shop = c.get('shop')
    const customer = await requireCustomer(ctx(shop), c.req.param('id'))
    const orders = await listOrders(ctx(shop), { customerId: customer.id, limit: 50 })
    const chats = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.shopId, shop.id), eq(conversations.customerId, customer.id)))
    return c.json({ customer: customerView(customer), orders, chats })
  })

  app.get('/conversations', async (c) => {
    const shop = c.get('shop')
    const channel = c.req.query('channel')
    const rows = await db
      .select({
        conv: conversations,
        customer: customers.name,
        last: sql<
          string | null
        >`(select coalesce(m.transcript, m.text) from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
        lastAt: sql<
          number | null
        >`(select max(m.created_at) from messages m where m.conversation_id = ${conversations.id})`,
      })
      .from(conversations)
      .leftJoin(customers, eq(customers.id, conversations.customerId))
      .where(
        and(
          eq(conversations.shopId, shop.id),
          ne(conversations.channel, 'telegram_seller'),
          channel ? eq(conversations.channel, channel as 'webchat') : undefined,
        ),
      )
      .orderBy(desc(conversations.lastInboundAt))
      .limit(100)
    return c.json({
      conversations: rows.map((r) => ({
        id: r.conv.id,
        channel: r.conv.channel,
        name: r.customer ?? r.conv.profileName ?? 'Customer',
        customerId: r.conv.customerId,
        pausedUntil: r.conv.pausedUntil,
        last: r.last,
        lastAt: r.lastAt ?? r.conv.lastInboundAt,
      })),
    })
  })

  app.get('/conversations/:id/messages', async (c) => {
    const conv = await conversationOf(c.get('shop'), c.req.param('id'))
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.createdAt)
      .limit(300)
    return c.json({
      conversation: conv,
      messages: rows.map((m) => ({ ...m, mediaUrl: m.mediaId ? `/media/${m.mediaId}` : null })),
    })
  })

  app.post('/conversations/:id/messages', async (c) => {
    const conv = await conversationOf(c.get('shop'), c.req.param('id'))
    const { text } = await body(c, sellerMessage)
    await sendToCustomer(deps, conv, { kind: 'text', text }, 'seller')
    return c.json({ ok: true })
  })

  app.post('/conversations/:id/takeover', async (c) => {
    const conv = await conversationOf(c.get('shop'), c.req.param('id'))
    const until = deps.now() + 2 * 60 * 60 * 1000
    await db.update(conversations).set({ pausedUntil: until }).where(eq(conversations.id, conv.id))
    return c.json({ pausedUntil: until })
  })

  app.post('/conversations/:id/resume', async (c) => {
    const conv = await conversationOf(c.get('shop'), c.req.param('id'))
    await db.update(conversations).set({ pausedUntil: null }).where(eq(conversations.id, conv.id))
    return c.json({ pausedUntil: null })
  })

  app.get('/activity', async (c) => {
    const shop = c.get('shop')
    const turnId = c.req.query('turnId')
    const rows = await db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.shopId, shop.id), turnId ? eq(activityLog.turnId, turnId) : undefined),
      )
      .orderBy(desc(activityLog.createdAt), desc(activityLog.step))
      .limit(200)
      .offset(Number(c.req.query('offset') ?? 0))
    return c.json({ activity: rows })
  })

  app.get('/pending', async (c) => {
    const shop = c.get('shop')
    const status = c.req.query('status') ?? 'pending'
    const rows = await db
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.shopId, shop.id),
          inArray(pendingActions.status, status.split(',') as never),
        ),
      )
      .orderBy(desc(pendingActions.createdAt))
      .limit(100)
    return c.json({ pending: rows })
  })

  app.post('/pending/:id', async (c) => {
    const shop = c.get('shop')
    const d = await body(c, pendingDecision)
    if (d.action === 'cancel') {
      await cancel(deps, shop, c.req.param('id'))
      return c.json({ ok: true })
    }
    return c.json(await approve(deps, shop, c.req.param('id'), d.text))
  })

  app.get('/reports/sales', async (c) =>
    c.json(
      await salesReport(ctx(c.get('shop')), { from: c.req.query('from'), to: c.req.query('to') }),
    ),
  )

  return app
}
