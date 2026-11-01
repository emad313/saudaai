import { formatMoney, sumPoisha } from '@saudaai/shared'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { write, type Tx } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import {
  conversations,
  customers,
  orderLines,
  orders,
  orderStatuses,
  payments,
  products,
  shops,
  variants,
} from '../db/schema.ts'
import { log } from '../log.ts'
import { storeFor, type Store } from '../stores/index.ts'
import { applyProduct } from '../stores/sync.ts'
import { StoreError } from '../stores/types.ts'
import { ToolError, type Ctx } from './ctx.ts'
import { requireCustomer } from './customers.ts'
import { deliveryFor } from './delivery.ts'

export type Order = typeof orders.$inferSelect
export type OrderStatus = (typeof orderStatuses)[number]
export type LineInput = { variantId: string; qty: number }

const transitions: Record<OrderStatus, OrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

function mergeLines(lines: LineInput[]): LineInput[] {
  const qty = new Map<string, number>()
  for (const l of lines) qty.set(l.variantId, (qty.get(l.variantId) ?? 0) + l.qty)
  return [...qty].map(([variantId, n]) => ({ variantId, qty: n }))
}

async function reserve(tx: Tx, shopId: string, line: LineInput) {
  const [row] = await tx
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.id, line.variantId), eq(products.shopId, shopId)))
  if (!row) throw new ToolError('not_found', `variant ${line.variantId} not found`)
  if (row.p.status !== 'active') {
    throw new ToolError('not_active', `${row.p.name} is not in the active catalog yet`)
  }
  const res = await tx
    .update(variants)
    .set({ reserved: sql`${variants.reserved} + ${line.qty}` })
    .where(
      and(eq(variants.id, row.v.id), sql`${variants.stock} - ${variants.reserved} >= ${line.qty}`),
    )
  if (res.rowsAffected === 0) {
    const label = [row.p.name, row.v.size, row.v.color].filter(Boolean).join(' ')
    throw new ToolError(
      'out_of_stock',
      `${label}: asked ${line.qty}, only ${(row.v.stock ?? 0) - row.v.reserved} available`,
    )
  }
  return {
    variantId: row.v.id,
    qty: line.qty,
    unitPricePoisha: row.v.pricePoisha,
    lineTotalPoisha: row.v.pricePoisha * line.qty,
  }
}

async function priceLine(tx: Tx, shopId: string, line: LineInput) {
  const [row] = await tx
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.id, line.variantId), eq(products.shopId, shopId)))
  if (!row) throw new ToolError('not_found', `variant ${line.variantId} not found`)
  if (row.p.status !== 'active') {
    throw new ToolError('not_active', `${row.p.name} is not in the active catalog`)
  }
  if (row.v.stock !== null && row.v.stock < line.qty) {
    const label = [row.p.name, row.v.size, row.v.color].filter(Boolean).join(' ')
    throw new ToolError('out_of_stock', `${label}: asked ${line.qty}, only ${row.v.stock} in stock`)
  }
  return {
    variantId: row.v.id,
    qty: line.qty,
    unitPricePoisha: row.v.pricePoisha,
    lineTotalPoisha: row.v.pricePoisha * line.qty,
  }
}

// The store is the source of truth: refresh price and stock from it right before ordering.
async function refreshFromStore(ctx: Ctx, store: Store, lines: LineInput[]) {
  const rows = await ctx.db
    .select({ p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      inArray(
        variants.id,
        lines.map((l) => l.variantId),
      ),
    )
  const seen = new Set<string>()
  for (const { p } of rows) {
    if (!p.externalId || seen.has(p.externalId)) continue
    seen.add(p.externalId)
    const live = await storeCall(() => store.connector!.getProduct(p.externalId!))
    if (!live) {
      await ctx.db.update(products).set({ status: 'archived' }).where(eq(products.id, p.id))
      throw new ToolError('not_found', `${p.name} is no longer in the store`)
    }
    await applyProduct(ctx.db, store.row!, live, ctx.now)
  }
}

async function storeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof StoreError)) throw err
    throw new ToolError('store_failed', `the store did not accept it: ${err.message}`)
  }
}

export async function createOrder(
  ctx: Ctx,
  args: {
    customerId: string
    lines: LineInput[]
    deliveryArea: string
    deliveryAddress?: string
    paymentMethod: string
    note?: string
    source: Order['source']
  },
) {
  if (!ctx.shop.paymentMethods.includes(args.paymentMethod)) {
    throw new ToolError(
      'bad_payment_method',
      `shop accepts ${ctx.shop.paymentMethods.join(', ')}, not ${args.paymentMethod}`,
    )
  }
  if (!args.lines.length) throw new ToolError('empty_order', 'order needs at least one line')
  const customer = await requireCustomer(ctx, args.customerId)
  const delivery = deliveryFor(ctx.shop, args.deliveryArea)
  const orderId = newId()
  const store = await storeFor(ctx.db, ctx.shop.id)
  const merged = mergeLines(args.lines)
  if (store.connector) await refreshFromStore(ctx, store, merged)

  await write(ctx.db, async (tx) => {
    const lines = []
    for (const line of merged) {
      // External stores decrement stock when the order lands there; only builtin reserves locally.
      lines.push(
        store.connector
          ? await priceLine(tx, ctx.shop.id, line)
          : await reserve(tx, ctx.shop.id, line),
      )
    }
    const subtotal = sumPoisha(lines.map((l) => l.lineTotalPoisha))
    const [seq] = await tx
      .update(shops)
      .set({ orderSeq: sql`${shops.orderSeq} + 1` })
      .where(eq(shops.id, ctx.shop.id))
      .returning({ n: shops.orderSeq })
    await tx.insert(orders).values({
      id: orderId,
      shopId: ctx.shop.id,
      number: seq!.n,
      customerId: customer.id,
      conversationId: ctx.conversationId ?? null,
      status: 'draft',
      paymentMethod: args.paymentMethod,
      paymentStatus: 'unpaid',
      deliveryArea: args.deliveryArea,
      deliveryAddress: args.deliveryAddress ?? customer.address,
      deliveryPoisha: delivery.poisha,
      subtotalPoisha: subtotal,
      totalPoisha: subtotal + delivery.poisha,
      note: args.note ?? null,
      source: args.source,
      storeId: store.connector ? store.row!.id : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    await tx.insert(orderLines).values(lines.map((l) => ({ id: newId(), orderId, ...l })))
  })
  return getOrder(ctx, { orderId })
}

async function requireOrder(ctx: Ctx, ref: { orderId?: string; number?: number }) {
  const where = ref.orderId ? eq(orders.id, ref.orderId) : eq(orders.number, ref.number ?? -1)
  const [o] = await ctx.db
    .select()
    .from(orders)
    .where(and(where, eq(orders.shopId, ctx.shop.id)))
  const visible =
    o && (ctx.actor !== 'customer' || (ctx.customerId ? o.customerId === ctx.customerId : false))
  if (!o || !visible) {
    throw new ToolError('not_found', `order ${ref.orderId ?? `#${ref.number}`} not found`)
  }
  return o
}

export async function getOrder(ctx: Ctx, ref: { orderId?: string; number?: number }) {
  const o = await requireOrder(ctx, ref)
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, o.customerId))
  const lines = await ctx.db
    .select({ l: orderLines, v: variants, p: products })
    .from(orderLines)
    .innerJoin(variants, eq(variants.id, orderLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(orderLines.orderId, o.id))
  const due = o.totalPoisha - o.paidPoisha
  return {
    orderId: o.id,
    number: o.number,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    customer: { customerId: c?.id, name: c?.name, phone: c?.phone },
    deliveryArea: o.deliveryArea,
    deliveryAddress: o.deliveryAddress,
    lines: lines.map(({ l, v, p }) => ({
      product: p.name,
      size: v.size,
      color: v.color,
      qty: l.qty,
      unitPrice: formatMoney(l.unitPricePoisha, ctx.shop.currency),
      lineTotal: formatMoney(l.lineTotalPoisha, ctx.shop.currency),
    })),
    subtotal: formatMoney(o.subtotalPoisha, ctx.shop.currency),
    delivery: formatMoney(o.deliveryPoisha, ctx.shop.currency),
    total: formatMoney(o.totalPoisha, ctx.shop.currency),
    paid: formatMoney(o.paidPoisha, ctx.shop.currency),
    due: formatMoney(due, ctx.shop.currency),
    totalPoisha: o.totalPoisha,
    duePoisha: due,
    externalNumber: o.externalNumber,
    adminUrl: o.adminUrl,
    createdAt: o.createdAt,
  }
}

async function pushToStore(ctx: Ctx, store: Store, o: Order) {
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, o.customerId))
  const lines = await ctx.db
    .select({ qty: orderLines.qty, externalId: variants.externalId })
    .from(orderLines)
    .innerJoin(variants, eq(variants.id, orderLines.variantId))
    .where(eq(orderLines.orderId, o.id))
  const [conv] = o.conversationId
    ? await ctx.db.select().from(conversations).where(eq(conversations.id, o.conversationId))
    : []
  const made = await storeCall(() =>
    store.connector!.createOrder({
      customer: {
        name: c?.name ?? 'Customer',
        phone: c?.phone ?? undefined,
        address: o.deliveryAddress ?? undefined,
        area: o.deliveryArea,
      },
      lines: lines.map((l) => ({ variantExternalId: l.externalId!, qty: l.qty })),
      shippingPoisha: o.deliveryPoisha,
      paymentMethod: o.paymentMethod,
      note: o.note ?? undefined,
      tags: ['saudaai', conv?.channel ?? o.source],
    }),
  )
  await ctx.db
    .update(orders)
    .set({
      externalId: made.externalId,
      externalNumber: made.number,
      adminUrl: made.adminUrl ?? null,
    })
    .where(eq(orders.id, o.id))
  if (made.totalPoisha !== o.totalPoisha) {
    log.warn(
      { orderId: o.id, ours: o.totalPoisha, store: made.totalPoisha },
      'store total differs from ours',
    )
    return `store total ${formatMoney(made.totalPoisha, ctx.shop.currency)} differs from ours ${formatMoney(o.totalPoisha, ctx.shop.currency)}, check order ${made.number} in the store`
  }
  return null
}

export async function updateOrderStatus(ctx: Ctx, args: { orderId: string; status: OrderStatus }) {
  const o = await requireOrder(ctx, { orderId: args.orderId })
  if (!transitions[o.status].includes(args.status)) {
    throw new ToolError(
      'bad_transition',
      `order #${o.number} is ${o.status}, cannot become ${args.status}`,
    )
  }
  let storeWarning: string | null = null
  if (o.storeId) {
    const store = await storeFor(ctx.db, ctx.shop.id)
    if (store.connector && store.row?.id === o.storeId) {
      if (args.status === 'confirmed' && !o.externalId) {
        storeWarning = await pushToStore(ctx, store, o)
      } else if (o.externalId) {
        await storeCall(() =>
          store.connector!.updateOrder(o.externalId!, {
            status: args.status as Exclude<OrderStatus, 'draft'>,
          }),
        )
      }
    }
  }
  await write(ctx.db, async (tx) => {
    const lines = o.storeId
      ? []
      : await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id))
    for (const l of lines) {
      if (args.status === 'cancelled') {
        await tx
          .update(variants)
          .set({ reserved: sql`${variants.reserved} - ${l.qty}` })
          .where(eq(variants.id, l.variantId))
      }
      if (args.status === 'shipped') {
        await tx
          .update(variants)
          .set({
            stock: sql`${variants.stock} - ${l.qty}`,
            reserved: sql`${variants.reserved} - ${l.qty}`,
          })
          .where(eq(variants.id, l.variantId))
      }
    }
    await tx
      .update(orders)
      .set({ status: args.status, updatedAt: ctx.now })
      .where(eq(orders.id, o.id))
  })
  const order = await getOrder(ctx, { orderId: o.id })
  return storeWarning ? { ...order, storeWarning } : order
}

export async function recordPayment(
  ctx: Ctx,
  args: { orderId: string; amountPoisha: number; method: string },
) {
  const o = await requireOrder(ctx, { orderId: args.orderId })
  if (o.status === 'cancelled') throw new ToolError('cancelled', `order #${o.number} is cancelled`)
  const due = o.totalPoisha - o.paidPoisha
  if (args.amountPoisha <= 0) throw new ToolError('bad_amount', 'payment must be positive')
  if (args.amountPoisha > due) {
    throw new ToolError(
      'overpaid',
      `order #${o.number} only has ${formatMoney(due, ctx.shop.currency)} due`,
    )
  }
  const paid = o.paidPoisha + args.amountPoisha
  if (o.externalId) {
    const store = await storeFor(ctx.db, ctx.shop.id)
    if (store.connector && store.row?.id === o.storeId) {
      await storeCall(() =>
        store.connector!.updateOrder(o.externalId!, {
          paidPoisha: paid,
          note: `SaudaAI: ${formatMoney(args.amountPoisha, ctx.shop.currency)} received by ${args.method}`,
        }),
      )
    }
  }
  await write(ctx.db, async (tx) => {
    await tx.insert(payments).values({
      id: newId(),
      orderId: o.id,
      amountPoisha: args.amountPoisha,
      method: args.method,
      createdAt: ctx.now,
    })
    await tx
      .update(orders)
      .set({
        paidPoisha: paid,
        paymentStatus: paid === o.totalPoisha ? 'paid' : 'partial',
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, o.id))
  })
  return getOrder(ctx, { orderId: o.id })
}

export async function listOrders(
  ctx: Ctx,
  args: { status?: OrderStatus[]; customerId?: string; limit?: number; offset?: number },
) {
  const rows = await ctx.db
    .select({ o: orders, c: customers })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(
      and(
        eq(orders.shopId, ctx.shop.id),
        args.status ? inArray(orders.status, args.status) : undefined,
        args.customerId ? eq(orders.customerId, args.customerId) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(args.limit ?? 20)
    .offset(args.offset ?? 0)
  return rows.map(({ o, c }) => ({
    orderId: o.id,
    number: o.number,
    customer: c.name,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    total: formatMoney(o.totalPoisha, ctx.shop.currency),
    totalPoisha: o.totalPoisha,
    duePoisha: o.totalPoisha - o.paidPoisha,
    createdAt: o.createdAt,
  }))
}

export async function ordersDue(ctx: Ctx, olderThan: number) {
  const rows = await ctx.db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, ctx.shop.id),
        ne(orders.paymentStatus, 'paid'),
        inArray(orders.status, ['confirmed', 'shipped', 'delivered']),
        sql`${orders.createdAt} <= ${olderThan}`,
        // cash on delivery is only owed once the parcel has arrived
        sql`(${orders.paymentMethod} != 'cod' or ${orders.status} = 'delivered')`,
      ),
    )
  return Promise.all(rows.map((r) => getOrder(ctx, { orderId: r.id })))
}
