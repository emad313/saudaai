import { formatMoney, sumPoisha } from '@saudaai/shared'
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import {
  activityLog,
  conversations,
  messages,
  modelCalls,
  orderLines,
  orders,
  pendingActions,
  products,
  variants,
} from '../db/schema.ts'
import { env } from '../env.ts'
import type { Ctx } from './ctx.ts'
import { dhakaDate, dhakaDayStart } from './text.ts'

const day = 24 * 60 * 60 * 1000

export function analyticsRange(ctx: Ctx, from?: string, to?: string) {
  const parse = (d: string) => Date.parse(`${d}T00:00:00+06:00`)
  const end = to ? parse(to) + day : dhakaDayStart(ctx.now) + day
  const start = from ? parse(from) : end - 7 * day
  return { start, end, from: dhakaDate(start), to: dhakaDate(end - 1) }
}

const count = <K extends string>(keys: K[]) => {
  const out = new Map<K, number>()
  for (const k of keys) out.set(k, (out.get(k) ?? 0) + 1)
  return [...out].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n)
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

async function sales(ctx: Ctx, start: number, end: number) {
  const rows = await ctx.db
    .select({ o: orders, channel: conversations.channel })
    .from(orders)
    .leftJoin(conversations, eq(conversations.id, orders.conversationId))
    .where(
      and(
        eq(orders.shopId, ctx.shop.id),
        inArray(orders.status, ['confirmed', 'shipped', 'delivered']),
        gte(orders.createdAt, start),
        lt(orders.createdAt, end),
      ),
    )
  const channelOf = (r: (typeof rows)[number]) =>
    r.o.source === 'store'
      ? 'store'
      : r.o.source === 'customer_chat'
        ? (r.channel ?? 'webchat')
        : 'telegram'
  const revenue = sumPoisha(rows.map((r) => r.o.subtotalPoisha))
  const days: { date: string; orders: number; revenuePoisha: number }[] = []
  for (let t = start; t < end; t += day) {
    const date = dhakaDate(t)
    const on = rows.filter((r) => dhakaDate(r.o.createdAt) === date)
    days.push({
      date,
      orders: on.length,
      revenuePoisha: sumPoisha(on.map((r) => r.o.subtotalPoisha)),
    })
  }
  const byChannel = new Map<string, { orders: number; revenuePoisha: number }>()
  for (const r of rows) {
    const c = byChannel.get(channelOf(r)) ?? { orders: 0, revenuePoisha: 0 }
    c.orders += 1
    c.revenuePoisha += r.o.subtotalPoisha
    byChannel.set(channelOf(r), c)
  }
  const lines = rows.length
    ? await ctx.db
        .select({ name: products.name, qty: orderLines.qty, total: orderLines.lineTotalPoisha })
        .from(orderLines)
        .innerJoin(variants, eq(variants.id, orderLines.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(
          inArray(
            orderLines.orderId,
            rows.map((r) => r.o.id),
          ),
        )
    : []
  const top = new Map<string, { qty: number; revenuePoisha: number }>()
  for (const l of lines) {
    const p = top.get(l.name) ?? { qty: 0, revenuePoisha: 0 }
    p.qty += l.qty
    p.revenuePoisha += l.total
    top.set(l.name, p)
  }
  return {
    orders: rows.length,
    revenuePoisha: revenue,
    averageOrderPoisha: rows.length ? Math.round(revenue / rows.length / 100) * 100 : 0,
    days,
    byChannel: [...byChannel]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.revenuePoisha - a.revenuePoisha),
    topProducts: [...top]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8),
  }
}

async function agent(ctx: Ctx, start: number, end: number) {
  const convs = await ctx.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.shopId, ctx.shop.id),
        ne(conversations.channel, 'telegram_seller'),
        gte(conversations.lastInboundAt, start),
      ),
    )
  const ids = convs.map((c) => c.id)
  const msgs = ids.length
    ? await ctx.db
        .select({
          conversationId: messages.conversationId,
          role: messages.role,
          at: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            inArray(messages.conversationId, ids),
            gte(messages.createdAt, start),
            lt(messages.createdAt, end),
          ),
        )
        .orderBy(messages.createdAt)
    : []
  const channelOf = new Map(convs.map((c) => [c.id, c.channel]))
  const perChannel = new Map<string, { in: number; out: number; waits: number[] }>()
  const firstIn = new Map<string, number>()
  const owner = new Set<string>()
  for (const m of msgs) {
    const ch = channelOf.get(m.conversationId)!
    const c = perChannel.get(ch) ?? { in: 0, out: 0, waits: [] }
    if (m.role === 'customer') {
      c.in += 1
      if (!firstIn.has(m.conversationId)) firstIn.set(m.conversationId, m.at)
    } else if (m.role === 'agent' || m.role === 'seller') {
      c.out += 1
      const asked = firstIn.get(m.conversationId)
      if (asked !== undefined) {
        c.waits.push(m.at - asked)
        firstIn.set(m.conversationId, Number.POSITIVE_INFINITY)
      }
      if (m.role === 'seller') owner.add(m.conversationId)
    }
    perChannel.set(ch, c)
  }

  const pending = await ctx.db
    .select({ tool: pendingActions.tool, status: pendingActions.status, args: pendingActions.args })
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.shopId, ctx.shop.id),
        gte(pendingActions.createdAt, start),
        lt(pendingActions.createdAt, end),
      ),
    )
  const held = pending.filter((p) => p.tool === 'customer_reply')
  for (const h of held) owner.add(String(h.args.conversationId))

  const started = convs.filter((c) => c.createdAt >= start && c.createdAt < end)
  const ordered = started.length
    ? await ctx.db
        .select({ conversationId: orders.conversationId, at: orders.createdAt })
        .from(orders)
        .where(
          inArray(
            orders.conversationId,
            started.map((c) => c.id),
          ),
        )
    : []
  const converted = started.filter((c) =>
    ordered.some((o) => o.conversationId === c.id && o.at - c.createdAt <= 2 * day),
  )
  const talked = convs.filter((c) => msgs.some((m) => m.conversationId === c.id))

  const failures = await ctx.db
    .select({ decision: activityLog.decision, at: activityLog.createdAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.shopId, ctx.shop.id),
        inArray(activityLog.decision, ['error', 'invalid']),
        gte(activityLog.createdAt, start),
        lt(activityLog.createdAt, end),
      ),
    )
  const modelErrors = await ctx.db
    .select({ at: modelCalls.createdAt, error: modelCalls.error })
    .from(modelCalls)
    .where(and(gte(modelCalls.createdAt, start), lt(modelCalls.createdAt, end)))

  return {
    conversationsStarted: started.length,
    channels: [...perChannel].map(([channel, c]) => ({
      channel,
      messagesIn: c.in,
      messagesOut: c.out,
      medianFirstReplyMs: median(c.waits),
    })),
    handledByAi: talked.filter((c) => !owner.has(c.id)).length,
    handedToOwner: talked.filter((c) => owner.has(c.id)).length,
    heldReplies: count(
      held.map((h) =>
        String(h.args.reason ?? '').startsWith('mentions an offer')
          ? 'mentions an offer'
          : 'price not in shop data',
      ),
    ),
    approvals: count(pending.filter((p) => p.tool !== 'customer_reply').map((p) => p.status)),
    chatToOrder: { conversations: started.length, ordered: converted.length },
    failuresByDay: count([
      ...failures.map((f) => `${dhakaDate(f.at)} tool`),
      ...modelErrors.filter((m) => m.error).map((m) => `${dhakaDate(m.at)} model`),
    ]),
  }
}

type Match = { productId: string; name: string; variants: { available: number | null }[] }

async function demand(ctx: Ctx, start: number, end: number) {
  const rows = await ctx.db
    .select({ tool: activityLog.tool, args: activityLog.args, result: activityLog.result })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.shopId, ctx.shop.id),
        eq(activityLog.actor, 'customer'),
        inArray(activityLog.tool, ['find_product', 'get_product']),
        gte(activityLog.createdAt, start),
        lt(activityLog.createdAt, end),
      ),
    )
  const asked: string[] = []
  const missing: string[] = []
  const soldOut: string[] = []
  for (const r of rows) {
    const result = (r.result ?? {}) as { matches?: Match[] } & Partial<Match>
    const found: Match[] =
      r.tool === 'find_product' ? (result.matches ?? []) : result.name ? [result as Match] : []
    if (r.tool === 'find_product' && !found.length) {
      missing.push(
        String((r.args as { query?: string } | null)?.query ?? '')
          .toLowerCase()
          .trim(),
      )
    }
    for (const m of found.slice(0, 1)) {
      asked.push(m.name)
      if (m.variants?.length && m.variants.every((v) => v.available === 0)) soldOut.push(m.name)
    }
  }
  return {
    mostAsked: count(asked)
      .slice(0, 10)
      .map(({ key, n }) => ({ name: key, n })),
    noMatch: count(missing.filter(Boolean))
      .slice(0, 15)
      .map(({ key, n }) => ({ query: key, n })),
    outOfStockAsks: count(soldOut)
      .slice(0, 10)
      .map(({ key, n }) => ({ name: key, n })),
  }
}

async function cost(ctx: Ctx, start: number, end: number) {
  const calls = await ctx.db
    .select()
    .from(modelCalls)
    .where(and(gte(modelCalls.createdAt, start), lt(modelCalls.createdAt, end)))
  const byPurpose = new Map<
    string,
    { calls: number; cached: number; input: number; output: number }
  >()
  for (const c of calls) {
    const p = byPurpose.get(c.purpose) ?? { calls: 0, cached: 0, input: 0, output: 0 }
    p.calls += 1
    if (c.cacheHit) p.cached += 1
    p.input += c.inputUnits ?? 0
    p.output += c.outputUnits ?? 0
    byPurpose.set(c.purpose, p)
  }
  const priced =
    env.MODEL_PRICE_INPUT_PER_M !== undefined || env.MODEL_PRICE_PER_IMAGE !== undefined
  let usd = 0
  for (const [purpose, p] of byPurpose) {
    const real = p.calls - p.cached
    if (purpose === 'image' || purpose === 'segment') usd += real * (env.MODEL_PRICE_PER_IMAGE ?? 0)
    else {
      usd +=
        (p.input / 1e6) * (env.MODEL_PRICE_INPUT_PER_M ?? 0) +
        (p.output / 1e6) * (env.MODEL_PRICE_OUTPUT_PER_M ?? 0)
    }
  }
  return {
    purposes: [...byPurpose].map(([purpose, p]) => ({ purpose, ...p })),
    cacheHitRate: calls.length
      ? Math.round((calls.filter((c) => c.cacheHit).length / calls.length) * 100)
      : 0,
    estimatedUsd: priced ? Math.round(usd * 100) / 100 : null,
  }
}

export async function analytics(ctx: Ctx, args: { from?: string; to?: string }) {
  const r = analyticsRange(ctx, args.from, args.to)
  const [s, a, d, c] = await Promise.all([
    sales(ctx, r.start, r.end),
    agent(ctx, r.start, r.end),
    demand(ctx, r.start, r.end),
    cost(ctx, r.start, r.end),
  ])
  return { from: r.from, to: r.to, sales: s, agent: a, demand: d, cost: c }
}

// What the agent reads when the owner asks: short, with taka formatted.
export async function analyticsForAgent(
  ctx: Ctx,
  args: { from?: string; to?: string; focus?: 'sales' | 'agent' | 'demand' | 'cost' },
) {
  const all = await analytics(ctx, args)
  const sales = {
    orders: all.sales.orders,
    revenue: formatMoney(all.sales.revenuePoisha, ctx.shop.currency),
    averageOrder: formatMoney(all.sales.averageOrderPoisha, ctx.shop.currency),
    byChannel: all.sales.byChannel.map((c) => ({
      ...c,
      revenue: formatMoney(c.revenuePoisha, ctx.shop.currency),
    })),
    topProducts: all.sales.topProducts.map((p) => ({
      name: p.name,
      qty: p.qty,
      revenue: formatMoney(p.revenuePoisha, ctx.shop.currency),
    })),
  }
  const parts = { sales, agent: all.agent, demand: all.demand, cost: all.cost }
  return {
    from: all.from,
    to: all.to,
    ...(args.focus ? { [args.focus]: parts[args.focus] } : parts),
  }
}
