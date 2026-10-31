import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../db/ids.ts'
import { activityLog, conversations, messages, pendingActions } from '../db/schema.ts'
import { now, testShop } from '../test/shop.ts'
import { analytics, analyticsForAgent } from './analytics.ts'
import { createCustomer } from './customers.ts'
import { createOrder } from './orders.ts'
import { findProducts } from './products.ts'
import { salesReport } from './reports.ts'

let t: Awaited<ReturnType<typeof testShop>>
beforeEach(async () => {
  t = await testShop()
})

async function customerChat(channel: 'messenger' | 'whatsapp', replyAfterMs: number) {
  const id = newId()
  await t.db.insert(conversations).values({
    id,
    shopId: t.shop.id,
    channel,
    externalUserId: newId(),
    lastInboundAt: now - 60_000,
    createdAt: now - 60_000,
  })
  await t.db.insert(messages).values([
    {
      id: newId(),
      conversationId: id,
      role: 'customer',
      kind: 'text',
      text: 'kurti ache?',
      createdAt: now - 60_000,
    },
    {
      id: newId(),
      conversationId: id,
      role: 'agent',
      kind: 'text',
      text: 'ji ache',
      createdAt: now - 60_000 + replyAfterMs,
    },
  ])
  return id
}

describe('analytics', () => {
  it('agrees with the sales report over the same week', async () => {
    const a = await analytics(t.ctx(), {})
    const report = await salesReport(t.ctx(), { from: a.from, to: a.to })
    expect(a.sales.revenuePoisha).toBe(report.revenuePoisha)
    expect(a.sales.orders).toBe(report.orders)
    expect(a.sales.days).toHaveLength(7)
    expect(a.sales.days.reduce((s, d) => s + d.revenuePoisha, 0)).toBe(report.revenuePoisha)
    expect(a.sales.byChannel.map((c) => c.channel)).toEqual(['telegram'])
  })

  it('measures reply time, handoffs, conversion and demand from chats', async () => {
    const fast = await customerChat('messenger', 4_000)
    const slow = await customerChat('messenger', 10_000)
    await customerChat('whatsapp', 6_000)
    await t.db.insert(pendingActions).values({
      id: newId(),
      shopId: t.shop.id,
      conversationId: slow,
      tool: 'customer_reply',
      args: {
        conversationId: slow,
        text: 'special ৳700',
        reason: 'numbers not from shop data: 700',
      },
      preview: 'x',
      status: 'pending',
      expiresAt: now + 1,
      createdAt: now - 1000,
    })
    const c = await createCustomer(t.ctx(), { name: 'Mitu', phone: '01711000999', area: 'Mirpur' })
    const kurti = (await findProducts(t.ctx(), { query: 'maroon kurti' })).matches[0]!
    const order = await createOrder(t.ctx({ conversationId: fast }), {
      customerId: c.customerId,
      lines: [{ variantId: kurti.variants[0]!.variantId, qty: 1 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'cod',
      source: 'customer_chat',
    })
    const log = (tool: string, args: unknown, result: unknown) => ({
      id: newId(),
      shopId: t.shop.id,
      turnId: newId(),
      actor: 'customer' as const,
      step: 1,
      tool,
      args,
      result,
      decision: 'run' as const,
      latencyMs: 5,
      createdAt: now - 30_000,
    })
    await t.db
      .insert(activityLog)
      .values([
        log('find_product', { query: 'Panjabi' }, { ok: true, matches: [] }),
        log('find_product', { query: 'panjabi ' }, { ok: true, matches: [] }),
        log('find_product', { query: 'kurti' }, { ok: true, matches: [kurti] }),
        log(
          'get_product',
          { productId: kurti.productId },
          { ok: true, ...kurti, variants: kurti.variants.map((v) => ({ ...v, available: 0 })) },
        ),
      ])

    const a = await analytics(t.ctx(), {})
    const messenger = a.agent.channels.find((ch) => ch.channel === 'messenger')!
    expect(messenger).toMatchObject({ messagesIn: 2, messagesOut: 2, medianFirstReplyMs: 7_000 })
    expect(a.agent).toMatchObject({ conversationsStarted: 3, handledByAi: 2, handedToOwner: 1 })
    expect(a.agent.heldReplies).toEqual([{ key: 'price not in shop data', n: 1 }])
    expect(a.agent.chatToOrder).toEqual({ conversations: 3, ordered: 1 })
    expect(a.demand.noMatch).toEqual([{ query: 'panjabi', n: 2 }])
    expect(a.demand.mostAsked[0]).toEqual({ name: kurti.name, n: 2 })
    expect(a.demand.outOfStockAsks).toEqual([{ name: kurti.name, n: 1 }])
    expect(order.status).toBe('draft')
  })

  it('gives the agent formatted taka and only the part it asked for', async () => {
    const res = await analyticsForAgent(t.ctx(), { focus: 'sales' })
    expect(Object.keys(res).sort()).toEqual(['from', 'sales', 'to'])
    expect((res as { sales: { revenue: string } }).sales.revenue).toMatch(/^৳/)
  })
})
