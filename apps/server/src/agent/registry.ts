import { formatTaka } from '@saudaai/shared'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { conversations, orders, orderStatuses } from '../db/schema.ts'
import { canSendFreeform } from '../channels/window.ts'
import type { Ctx } from '../tools/ctx.ts'
import { ToolError } from '../tools/ctx.ts'
import { createCustomer, findCustomers, requireCustomer } from '../tools/customers.ts'
import { getDeliveryRules } from '../tools/delivery.ts'
import { recordExpense } from '../tools/expenses.ts'
import {
  createOrder,
  getOrder,
  listOrders,
  recordPayment,
  updateOrderStatus,
} from '../tools/orders.ts'
import {
  adjustStock,
  createProductDraft,
  findProducts,
  getProduct,
  requireProduct,
  setProductStatus,
} from '../tools/products.ts'
import { dailySummary, salesReport } from '../tools/reports.ts'
import { confirmationText, handoffReply, lineLabel, methodLabel, reminderText } from './copy.ts'
import type { Conversation, Deps } from './deps.ts'
import { conversationById, customerConversation, sendToCustomer } from './messaging.ts'
import { proposeOrRun } from './pending.ts'

export type TurnCtx = Ctx & {
  deps: Deps
  conversation: Conversation | null
  turnId: string
  inputKind: 'voice' | 'text' | 'photo'
}

export type Expose = 'seller' | 'customer' | 'both' | 'internal'

export type ToolDef = {
  name: string
  description: string
  schema: z.ZodObject
  expose: Expose
  endsTurn?: boolean
  guard?: (ctx: TurnCtx, args: never) => boolean | Promise<boolean>
  preview?: (ctx: TurnCtx, args: never) => Promise<string>
  run: (ctx: TurnCtx, args: never) => Promise<unknown>
  done?: (result: never) => string
}

function tool<S extends z.ZodObject>(def: {
  name: string
  description: string
  schema: S
  expose: Expose
  endsTurn?: boolean
  guard?: (ctx: TurnCtx, args: z.infer<S>) => boolean | Promise<boolean>
  preview?: (ctx: TurnCtx, args: z.infer<S>) => Promise<string>
  run: (ctx: TurnCtx, args: z.infer<S>) => Promise<unknown>
  done?: (result: never) => string
}): ToolDef {
  return def as unknown as ToolDef
}

const id = z.string().min(1)
const taka = z.number().int().positive().max(10_000_000)
const qty = z.number().int().min(1).max(100)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

type OrderView = Awaited<ReturnType<typeof getOrder>>

const orderLine = (o: OrderView) =>
  `#${o.number} ${o.customer.name}: ${o.lines.map(lineLabel).join(', ')} | total ${o.total} | ${methodLabel(o.paymentMethod)}`

export const asSeller = (ctx: TurnCtx): TurnCtx => ({ ...ctx, actor: 'seller' })

async function orderRow(ctx: TurnCtx, orderId: string) {
  const [o] = await ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, ctx.shop.id)))
  if (!o) throw new ToolError('not_found', `order ${orderId} not found`)
  return o
}

async function confirmAndSend(ctx: TurnCtx, orderId: string) {
  const seller = asSeller(ctx)
  const row = await orderRow(ctx, orderId)
  if (row.status === 'draft') await updateOrderStatus(seller, { orderId, status: 'confirmed' })
  else if (row.status !== 'confirmed') {
    throw new ToolError('bad_status', `order #${row.number} is ${row.status}`)
  }
  const order = await getOrder(seller, { orderId })
  const invoice = await ctx.deps.render.invoice(ctx.shop, orderId)
  const conv = await customerConversation(ctx.deps, ctx.shop.id, row.customerId, row.conversationId)
  if (conv && canSendFreeform(conv, ctx.now)) {
    await sendToCustomer(ctx.deps, conv, {
      kind: 'text',
      text: confirmationText(ctx.shop.name, order),
    })
    await sendToCustomer(ctx.deps, conv, {
      kind: 'image',
      mediaId: invoice.id,
      caption: `Invoice #${order.number}`,
    })
    return { ...order, invoiceMediaId: invoice.id, sentToCustomer: true, channel: conv.channel }
  }
  await ctx.deps.seller.sendMedia(
    ctx.shop,
    [invoice.id],
    `Invoice #${order.number}. ${order.customer.name} is not reachable on chat, forward it yourself.`,
  )
  return { ...order, invoiceMediaId: invoice.id, sentToCustomer: false }
}

async function remind(ctx: TurnCtx, orderId: string) {
  const row = await orderRow(ctx, orderId)
  const order = await getOrder(asSeller(ctx), { orderId })
  if (order.duePoisha <= 0)
    throw new ToolError('nothing_due', `order #${order.number} is fully paid`)
  const conv = await customerConversation(ctx.deps, ctx.shop.id, row.customerId, row.conversationId)
  if (!conv) throw new ToolError('no_channel', `${order.customer.name} has no chat with the shop`)
  const text = reminderText(ctx.shop.name, ctx.shop.bkashNumber, order)
  if (canSendFreeform(conv, ctx.now)) {
    await sendToCustomer(ctx.deps, conv, { kind: 'text', text })
    return { orderId, number: order.number, due: order.due, sent: true, via: 'message' }
  }
  if (conv.channel === 'whatsapp') {
    await sendToCustomer(ctx.deps, conv, {
      kind: 'template',
      name: 'payment_reminder',
      params: [order.customer.name ?? '', String(order.number), order.due],
      fallbackText: text,
    })
    return { orderId, number: order.number, due: order.due, sent: true, via: 'template' }
  }
  throw new ToolError('outside_window', `${order.customer.name} last wrote over 24 hours ago`)
}

async function customerOrderGuard(ctx: TurnCtx, orderId: string) {
  const rule = ctx.shop.auto.confirm_order
  if (ctx.shop.auto.send_order_confirmation) return false
  if (!rule) return true
  const row = await orderRow(ctx, orderId)
  return row.source !== 'customer_chat' || row.totalPoisha > rule.maxPoisha
}

export const tools: ToolDef[] = [
  tool({
    name: 'find_product',
    description:
      'Search the catalog by words the seller or customer used (Bangla, Banglish or English). Returns product and variant ids with price and available stock.',
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    expose: 'both',
    run: (ctx, a) => findProducts(ctx, a),
  }),
  tool({
    name: 'get_product',
    description: 'Full details of one product: variants, price, available stock, attributes.',
    schema: z.object({ productId: id }),
    expose: 'both',
    run: (ctx, a) => getProduct(ctx, a),
  }),
  tool({
    name: 'get_delivery_rules',
    description:
      'Delivery charge inside and outside Dhaka, delivery time, payment methods, bKash number.',
    schema: z.object({}),
    expose: 'both',
    run: async (ctx) => getDeliveryRules(ctx),
  }),
  tool({
    name: 'offer_choices',
    description:
      'Ask one short question with tappable options (for example sizes in stock). Ends the turn; the chosen option comes back as the next message.',
    schema: z.object({
      question: z.string().min(1),
      options: z.array(z.string().min(1).max(20)).min(2).max(10),
    }),
    expose: 'both',
    endsTurn: true,
    run: async (ctx, a) => {
      if (ctx.actor === 'seller') {
        await ctx.deps.seller.notify(ctx.shop, a.question, a.options)
      } else if (ctx.conversation) {
        await sendToCustomer(ctx.deps, ctx.conversation, {
          kind: 'text',
          text: a.question,
          quickReplies: a.options,
        })
      }
      return { asked: true }
    },
  }),

  tool({
    name: 'create_product_draft',
    description:
      'Create a new product as a draft. Price in whole taka. Each variant is one size and/or color with its stock count.',
    schema: z.object({
      name: z.string().min(2),
      category: z.string().min(2),
      priceTaka: taka,
      variants: z
        .array(
          z.object({
            size: z.string().optional(),
            color: z.string().optional(),
            stock: z.number().int().min(0).max(10_000),
            priceTaka: taka.optional(),
          }),
        )
        .max(30),
      aliases: z.array(z.string()).max(10).optional(),
      mediaId: z.string().optional(),
    }),
    expose: 'seller',
    run: (ctx, a) =>
      createProductDraft(ctx, {
        name: a.name,
        category: a.category,
        pricePoisha: a.priceTaka * 100,
        aliases: a.aliases,
        mediaId: a.mediaId,
        variants: a.variants.map((v) => ({
          size: v.size,
          color: v.color,
          stock: v.stock,
          pricePoisha: v.priceTaka ? v.priceTaka * 100 : undefined,
        })),
      }),
    done: (r: { name: string; price: string }) => `Draft product: ${r.name} ${r.price}`,
  }),
  tool({
    name: 'confirm_product',
    description: 'Publish a draft product to the live catalog.',
    schema: z.object({ productId: id }),
    expose: 'seller',
    run: (ctx, a) => setProductStatus(ctx, { productId: a.productId, status: 'active' }),
    done: (r: { name: string }) => `Live in catalog: ${r.name}`,
  }),
  tool({
    name: 'adjust_stock',
    description: 'Add (positive delta) or remove (negative delta) stock for one variant.',
    schema: z.object({
      variantId: id,
      delta: z
        .number()
        .int()
        .refine((n) => n !== 0, 'delta cannot be 0'),
      reason: z.string().min(1),
    }),
    expose: 'seller',
    run: (ctx, a) => adjustStock(ctx, a),
    done: (r: { product: string; size: string | null; color: string | null; available: number }) =>
      `Stock: ${[r.product, r.size, r.color].filter(Boolean).join(' ')} now ${r.available} available`,
  }),
  tool({
    name: 'find_customer',
    description: 'Find existing customers by name or phone number.',
    schema: z.object({ query: z.string().min(1) }),
    expose: 'seller',
    run: (ctx, a) => findCustomers(ctx, a),
  }),
  tool({
    name: 'create_customer',
    description: 'Add a customer. If the phone already exists the existing customer is returned.',
    schema: z.object({
      name: z.string().min(1),
      phone: z.string().optional(),
      address: z.string().optional(),
      area: z.string().optional(),
    }),
    expose: 'seller',
    run: (ctx, a) => createCustomer(ctx, a),
  }),
  tool({
    name: 'create_order',
    description:
      'Create a draft order and reserve stock. Prices and totals come from the catalog; never pass prices. deliveryArea is the area or city name. paymentMethod is one of the shop payment methods.',
    schema: z.object({
      customerId: id,
      lines: z
        .array(z.object({ variantId: id, qty }))
        .min(1)
        .max(20),
      deliveryArea: z.string().min(1),
      deliveryAddress: z.string().optional(),
      paymentMethod: z.string().min(1),
      note: z.string().optional(),
    }),
    expose: 'seller',
    run: (ctx, a) =>
      createOrder(ctx, {
        ...a,
        source: ctx.inputKind === 'voice' ? 'seller_voice' : 'seller_text',
      }),
    done: (r: OrderView) => `Draft order ${orderLine(r)}`,
  }),
  tool({
    name: 'get_order',
    description: 'Look up one order by id or by its number (like 1043).',
    schema: z
      .object({ orderId: z.string().optional(), number: z.number().int().optional() })
      .refine((a) => a.orderId || a.number, 'orderId or number is required'),
    expose: 'seller',
    run: (ctx, a) => getOrder(ctx, a),
  }),
  tool({
    name: 'list_orders',
    description: 'Recent orders, optionally filtered by status.',
    schema: z.object({
      status: z.array(z.enum(orderStatuses)).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    expose: 'seller',
    run: async (ctx, a) => ({ orders: await listOrders(ctx, a) }),
  }),
  tool({
    name: 'update_order_status',
    description:
      'Move an order to shipped, delivered or cancelled. To confirm a draft use send_order_confirmation instead.',
    schema: z.object({ orderId: id, status: z.enum(['shipped', 'delivered', 'cancelled']) }),
    expose: 'seller',
    guard: (_ctx, a) => a.status === 'cancelled',
    preview: async (ctx, a) => {
      const o = await getOrder(ctx, { orderId: a.orderId })
      return `Cancel order ${orderLine(o)}?`
    },
    run: (ctx, a) => updateOrderStatus(ctx, a),
    done: (r: OrderView) => `Order #${r.number} is now ${r.status}`,
  }),
  tool({
    name: 'record_payment',
    description: 'Record money received for an order, in whole taka.',
    schema: z.object({ orderId: id, amountTaka: taka, method: z.string().min(1) }),
    expose: 'seller',
    guard: () => true,
    preview: async (ctx, a) => {
      const o = await getOrder(ctx, { orderId: a.orderId })
      return `Record ${formatTaka(a.amountTaka * 100)} via ${methodLabel(a.method)} for order #${o.number} (${o.customer.name}, due ${o.due})?`
    },
    run: (ctx, a) =>
      recordPayment(ctx, {
        orderId: a.orderId,
        amountPoisha: a.amountTaka * 100,
        method: a.method,
      }),
    done: (r: OrderView) => `Payment saved for #${r.number}, due now ${r.due}`,
  }),
  tool({
    name: 'record_expense',
    description:
      'Record a shop expense in whole taka (transport, packaging, ads, stock purchase...).',
    schema: z.object({
      amountTaka: taka,
      category: z.string().min(1),
      note: z.string().optional(),
    }),
    expose: 'seller',
    run: (ctx, a) =>
      recordExpense(ctx, { amountPoisha: a.amountTaka * 100, category: a.category, note: a.note }),
    done: (r: { amount: string; category: string }) => `Expense ${r.amount} (${r.category})`,
  }),
  tool({
    name: 'send_order_confirmation',
    description:
      'Confirm a draft order and send the confirmation and invoice image to the customer. Needs seller approval.',
    schema: z.object({ orderId: id }),
    expose: 'seller',
    guard: (ctx, a) => customerOrderGuard(ctx, a.orderId),
    preview: async (ctx, a) => {
      const o = await getOrder(asSeller(ctx), { orderId: a.orderId })
      return `Confirm and send invoice?\n${orderLine(o)}\n${o.deliveryArea}${o.deliveryAddress ? `, ${o.deliveryAddress}` : ''}`
    },
    run: (ctx, a) => confirmAndSend(ctx, a.orderId),
    done: (r: OrderView & { sentToCustomer: boolean }) =>
      `Order #${r.number} confirmed${r.sentToCustomer ? ', invoice sent to customer' : ''}`,
  }),
  tool({
    name: 'send_payment_reminder',
    description: 'Send a polite payment reminder for an unpaid order. Needs seller approval.',
    schema: z.object({ orderId: id }),
    expose: 'seller',
    guard: (ctx) => !ctx.shop.auto.send_payment_reminder,
    preview: async (ctx, a) => {
      const o = await getOrder(asSeller(ctx), { orderId: a.orderId })
      return `Send payment reminder to ${o.customer.name} for #${o.number} (${o.due} due)?`
    },
    run: (ctx, a) => remind(ctx, a.orderId),
    done: (r: { number: number; due: string }) => `Reminder sent for #${r.number} (${r.due})`,
  }),
  tool({
    name: 'message_customer',
    description: 'Send a message to a customer on the chat they use, on behalf of the seller.',
    schema: z.object({ customerId: id, text: z.string().min(1).max(1000) }),
    expose: 'seller',
    run: async (ctx, a) => {
      const c = await requireCustomer(ctx, a.customerId)
      const conv = await customerConversation(ctx.deps, ctx.shop.id, c.id)
      if (!conv) throw new ToolError('no_channel', `${c.name} has no chat with the shop`)
      await sendToCustomer(ctx.deps, conv, { kind: 'text', text: a.text }, 'seller')
      return { sentTo: c.name, channel: conv.channel, text: a.text }
    },
    done: (r: { sentTo: string; text: string }) => `Sent to ${r.sentTo}: "${r.text}"`,
  }),
  tool({
    name: 'make_ad',
    description:
      'Make ready-to-post ad images for a product with an optional occasion (eid, puja, winter...) and offer line. Images are sent to the seller.',
    schema: z.object({
      productId: id,
      occasion: z.string().optional(),
      offerText: z.string().max(60).optional(),
      formats: z
        .array(z.enum(['square', 'story']))
        .min(1)
        .optional(),
    }),
    expose: 'seller',
    run: async (ctx, a) => {
      const p = await requireProduct(ctx, a.productId)
      const ads = await ctx.deps.render.ad(ctx.shop, {
        ...a,
        formats: a.formats ?? ['square', 'story'],
      })
      await ctx.deps.seller.sendMedia(
        ctx.shop,
        ads.map((m) => m.id),
        `Ads for ${p.name}`,
      )
      return { product: p.name, mediaIds: ads.map((m) => m.id) }
    },
    done: (r: { product: string; mediaIds: string[] }) =>
      `${r.mediaIds.length} ads made for ${r.product}`,
  }),
  tool({
    name: 'sales_report',
    description: 'Sales between two dates (YYYY-MM-DD, Dhaka time). Defaults to today.',
    schema: z.object({ from: date.optional(), to: date.optional() }),
    expose: 'seller',
    run: (ctx, a) => salesReport(ctx, a),
  }),
  tool({
    name: 'daily_summary',
    description: "Today's sales, top products, low stock, money due and draft orders waiting.",
    schema: z.object({}),
    expose: 'seller',
    run: (ctx) => dailySummary(ctx),
  }),

  tool({
    name: 'my_orders',
    description: "The customer's own recent orders and their status.",
    schema: z.object({}),
    expose: 'customer',
    run: async (ctx) => {
      if (!ctx.customerId) return { orders: [] }
      const list = await listOrders(ctx, { customerId: ctx.customerId, limit: 5 })
      return {
        orders: list.map(({ number, status, paymentStatus, total }) => ({
          number,
          status,
          paymentStatus,
          total,
        })),
      }
    },
  }),
  tool({
    name: 'send_product_photo',
    description: 'Send the product photo with its name and price to the customer.',
    schema: z.object({ productId: id }),
    expose: 'customer',
    run: async (ctx, a) => {
      const p = await requireProduct(ctx, a.productId)
      if (!p.imageId) throw new ToolError('no_photo', `${p.name} has no photo yet`)
      if (!ctx.conversation) throw new ToolError('no_channel', 'no conversation')
      await sendToCustomer(ctx.deps, ctx.conversation, {
        kind: 'image',
        mediaId: p.imageId,
        caption: `${p.name} - ${formatTaka(p.basePricePoisha)}`,
      })
      return { sent: true, product: p.name }
    },
  }),
  tool({
    name: 'place_order',
    description:
      'Place an order for the customer once you have the items (variant ids and quantities), their name, mobile number, full address, area and payment method. The shop confirms it before the invoice is sent.',
    schema: z.object({
      items: z
        .array(z.object({ variantId: id, qty }))
        .min(1)
        .max(10),
      name: z.string().min(1),
      phone: z.string().min(8),
      address: z.string().min(3),
      area: z.string().min(2),
      paymentMethod: z.string().min(1),
      note: z.string().optional(),
    }),
    expose: 'customer',
    run: async (ctx, a) => {
      const customer = await createCustomer(ctx, {
        name: a.name,
        phone: a.phone,
        address: a.address,
        area: a.area,
      })
      if (ctx.conversation) {
        await ctx.db
          .update(conversations)
          .set({ customerId: customer.customerId })
          .where(eq(conversations.id, ctx.conversation.id))
      }
      const linked: TurnCtx = { ...ctx, customerId: customer.customerId }
      const order = await createOrder(linked, {
        customerId: customer.customerId,
        lines: a.items,
        deliveryArea: a.area,
        deliveryAddress: a.address,
        paymentMethod: a.paymentMethod,
        note: a.note,
        source: 'customer_chat',
      })
      const next = await proposeOrRun(linked, 'send_order_confirmation', { orderId: order.orderId })
      return {
        number: order.number,
        total: order.total,
        lines: order.lines,
        status: next.pending ? 'waiting for shop confirmation' : 'confirmed',
      }
    },
  }),
  tool({
    name: 'request_handoff',
    description:
      'Hand the conversation to the shop owner: the customer asks for a human, is upset, or needs something you cannot do (discounts, returns, custom requests). Ends the turn.',
    schema: z.object({ reason: z.string().min(1) }),
    expose: 'customer',
    endsTurn: true,
    run: async (ctx, a) => {
      if (!ctx.conversation) return { handedOff: false }
      const until = ctx.now + 2 * 60 * 60 * 1000
      await ctx.db
        .update(conversations)
        .set({ pausedUntil: until })
        .where(eq(conversations.id, ctx.conversation.id))
      await sendToCustomer(ctx.deps, ctx.conversation, { kind: 'text', text: handoffReply })
      await ctx.deps.seller.notify(
        ctx.shop,
        `${ctx.conversation.profileName ?? 'A customer'} (${ctx.conversation.channel}) needs you: ${a.reason}\nReply with /reply ${ctx.conversation.id} <text>`,
      )
      return { handedOff: true }
    },
  }),

  tool({
    name: 'customer_reply',
    description: 'A reply to a customer that the seller has to approve before it is sent.',
    schema: z.object({ conversationId: id, text: z.string().min(1) }),
    expose: 'internal',
    guard: () => true,
    preview: async (_ctx, a) => `Send this reply to the customer?\n\n${a.text}`,
    run: async (ctx, a) => {
      const conv = await conversationById(ctx.deps, a.conversationId)
      if (!conv || conv.shopId !== ctx.shop.id)
        throw new ToolError('not_found', 'conversation not found')
      await sendToCustomer(ctx.deps, conv, { kind: 'text', text: a.text })
      return { sent: true }
    },
    done: () => 'Reply sent to customer',
  }),
]

export const toolByName = new Map(tools.map((t) => [t.name, t]))

export function toolsFor(actor: 'seller' | 'customer' | 'system') {
  return tools.filter((t) =>
    actor === 'customer'
      ? t.expose === 'customer' || t.expose === 'both'
      : t.expose === 'seller' || t.expose === 'both',
  )
}
