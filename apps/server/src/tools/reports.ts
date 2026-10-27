import { formatTaka, sumPoisha } from '@saudaai/shared'
import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { expenses, orderLines, orders, products, variants } from '../db/schema.ts'
import type { Ctx } from './ctx.ts'
import { dhakaDate, dhakaDayStart } from './text.ts'

const dayMs = 24 * 60 * 60 * 1000

function range(ctx: Ctx, from?: string, to?: string) {
  const parse = (d: string) => Date.parse(`${d}T00:00:00+06:00`)
  const start = from ? parse(from) : dhakaDayStart(ctx.now)
  const end = to ? parse(to) + dayMs : start + dayMs
  return { start, end }
}

export async function salesReport(ctx: Ctx, args: { from?: string; to?: string }) {
  const { start, end } = range(ctx, args.from, args.to)
  const sold = and(
    eq(orders.shopId, ctx.shop.id),
    inArray(orders.status, ['confirmed', 'shipped', 'delivered']),
    gte(orders.createdAt, start),
    lt(orders.createdAt, end),
  )
  const rows = await ctx.db.select().from(orders).where(sold)
  const top = await ctx.db
    .select({ name: products.name, qty: sql<number>`sum(${orderLines.qty})` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(variants, eq(variants.id, orderLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(sold)
    .groupBy(products.id)
    .orderBy(sql`sum(${orderLines.qty}) desc`)
    .limit(3)
  const spent = await ctx.db
    .select({ amount: expenses.amountPoisha })
    .from(expenses)
    .where(
      and(
        eq(expenses.shopId, ctx.shop.id),
        gte(expenses.createdAt, start),
        lt(expenses.createdAt, end),
      ),
    )
  const revenue = sumPoisha(rows.map((o) => o.subtotalPoisha))
  const expense = sumPoisha(spent.map((e) => e.amount))
  return {
    from: dhakaDate(start),
    to: dhakaDate(end - 1),
    orders: rows.length,
    revenue: formatTaka(revenue),
    collected: formatTaka(sumPoisha(rows.map((o) => o.paidPoisha))),
    expenses: formatTaka(expense),
    topProducts: top.map((t) => ({ name: t.name, qty: Number(t.qty) })),
    revenuePoisha: revenue,
  }
}

export async function lowStock(ctx: Ctx, threshold = 2) {
  const rows = await ctx.db
    .select({
      name: products.name,
      size: variants.size,
      color: variants.color,
      stock: variants.stock,
      reserved: variants.reserved,
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      and(
        eq(products.shopId, ctx.shop.id),
        eq(products.status, 'active'),
        sql`${variants.stock} - ${variants.reserved} <= ${threshold}`,
      ),
    )
  return rows.map((r) => ({
    item: [r.name, r.size, r.color].filter(Boolean).join(' '),
    available: r.stock - r.reserved,
  }))
}

export async function duesSummary(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      due: sql<number>`sum(${orders.totalPoisha} - ${orders.paidPoisha})`,
      n: sql<number>`count(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, ctx.shop.id),
        ne(orders.paymentStatus, 'paid'),
        inArray(orders.status, ['confirmed', 'shipped', 'delivered']),
      ),
    )
  const due = Number(rows[0]?.due ?? 0)
  return { orders: Number(rows[0]?.n ?? 0), due: formatTaka(due), duePoisha: due }
}

export async function dailySummary(ctx: Ctx) {
  const [today, stock, dues, drafts] = await Promise.all([
    salesReport(ctx, {}),
    lowStock(ctx),
    duesSummary(ctx),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.shopId, ctx.shop.id), eq(orders.status, 'draft'))),
  ])
  return { today, lowStock: stock, dues, draftOrders: Number(drafts[0]?.n ?? 0) }
}
