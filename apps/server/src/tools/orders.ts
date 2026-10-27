import { formatTaka, sumPoisha } from '@saudaai/shared'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { write, type Tx } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import {
  customers,
  orderLines,
  orders,
  orderStatuses,
  payments,
  products,
  shops,
  variants,
} from '../db/schema.ts'
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
      `${label}: asked ${line.qty}, only ${row.v.stock - row.v.reserved} available`,
    )
  }
  return {
    variantId: row.v.id,
    qty: line.qty,
    unitPricePoisha: row.v.pricePoisha,
    lineTotalPoisha: row.v.pricePoisha * line.qty,
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

  await write(ctx.db, async (tx) => {
    const lines = []
    for (const line of mergeLines(args.lines)) lines.push(await reserve(tx, ctx.shop.id, line))
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
      unitPrice: formatTaka(l.unitPricePoisha),
      lineTotal: formatTaka(l.lineTotalPoisha),
    })),
    subtotal: formatTaka(o.subtotalPoisha),
    delivery: formatTaka(o.deliveryPoisha),
    total: formatTaka(o.totalPoisha),
    paid: formatTaka(o.paidPoisha),
    due: formatTaka(due),
    totalPoisha: o.totalPoisha,
    duePoisha: due,
    createdAt: o.createdAt,
  }
}

export async function updateOrderStatus(ctx: Ctx, args: { orderId: string; status: OrderStatus }) {
  const o = await requireOrder(ctx, { orderId: args.orderId })
  if (!transitions[o.status].includes(args.status)) {
    throw new ToolError(
      'bad_transition',
      `order #${o.number} is ${o.status}, cannot become ${args.status}`,
    )
  }
  await write(ctx.db, async (tx) => {
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id))
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
  return getOrder(ctx, { orderId: o.id })
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
    throw new ToolError('overpaid', `order #${o.number} only has ${formatTaka(due)} due`)
  }
  const paid = o.paidPoisha + args.amountPoisha
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
    total: formatTaka(o.totalPoisha),
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
