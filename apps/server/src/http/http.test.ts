import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTelegram } from '../channels/telegram.ts'
import { loginCodes, orders, pendingActions } from '../db/schema.ts'
import { createInbox } from '../inbox.ts'
import { fakeDeps, say } from '../test/deps.ts'
import { now, testShop } from '../test/shop.ts'
import { findProducts } from '../tools/products.ts'
import { createApp } from './app.ts'

let t: Awaited<ReturnType<typeof testShop>>
let f: ReturnType<typeof fakeDeps>
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  t = await testShop()
  f = fakeDeps(t.db)
  const inbox = createInbox(f.deps)
  app = createApp({ db: t.db, deps: f.deps, inbox, telegram: createTelegram(t.db) })
})

async function signIn() {
  await t.db
    .insert(loginCodes)
    .values({ code: '654321', shopId: t.shop.id, expiresAt: Date.now() + 60_000 })
  const res = await app.request('/api/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '654321' }),
  })
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie')!.split(';')[0]!
}

describe('seller api', () => {
  it('needs a session', async () => {
    expect((await app.request('/api/dashboard')).status).toBe(401)
  })

  it('rejects a used login code', async () => {
    await signIn()
    const res = await app.request('/api/auth/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '654321' }),
    })
    expect(res.status).toBe(401)
  })

  it('shows the dashboard and lists orders', async () => {
    const cookie = await signIn()
    const dash = await (await app.request('/api/dashboard', { headers: { cookie } })).json()
    expect(dash.summary.draftOrders).toBe(1)
    const list = await (
      await app.request('/api/orders?status=draft', { headers: { cookie } })
    ).json()
    expect(list.orders).toHaveLength(1)
  })

  it('validates request bodies', async () => {
    const cookie = await signIn()
    const res = await app.request('/api/variants/x', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ delta: 0, reason: '' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('public shop', () => {
  it('shows the catalog without login', async () => {
    const res = await app.request('/api/s/nusrats-closet')
    const shop = await res.json()
    expect(shop.products).toHaveLength(12)
    expect(res.headers.get('set-cookie')).toContain('wsid=')
  })

  it('takes an order from the form and sends it for approval', async () => {
    const { matches } = await findProducts(t.ctx(), { query: 'tote bag' })
    const res = await app.request('/api/s/nusrats-closet/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: matches[0]!.variants[0]!.variantId, qty: 1 }],
        name: 'Web Buyer',
        phone: '01712345678',
        address: 'Road 5, Dhanmondi',
        area: 'Dhanmondi',
        paymentMethod: 'cod',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ total: '৳710', status: 'waiting for shop confirmation' })
    const pending = await t.db.select().from(pendingActions)
    expect(pending.map((p) => p.tool)).toEqual(['send_order_confirmation'])

    const cookie = await signIn()
    const approved = await app.request(`/api/pending/${pending[0]!.id}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    expect((await approved.json()).ok).toBe(true)
    const [o] = await t.db.select().from(orders).where(eq(orders.number, body.number))
    expect(o!.status).toBe('confirmed')
    expect(f.sent.map((s) => s.msg.kind)).toEqual(['text', 'image'])
  })
})

describe('meta webhook', () => {
  const payload = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: 'PAGE_ID',
        messaging: [
          {
            sender: { id: 'PSID1' },
            recipient: { id: 'PAGE_ID' },
            timestamp: now,
            message: { mid: 'mid.1', text: 'hi' },
          },
        ],
      },
    ],
  })
  const sig = `sha256=${createHmac('sha256', 'test-secret').update(payload).digest('hex')}`

  it('answers the verification handshake', async () => {
    const ok = await app.request(
      '/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42',
    )
    expect(await ok.text()).toBe('42')
    const bad = await app.request(
      '/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42',
    )
    expect(bad.status).toBe(403)
  })

  it('rejects unsigned deliveries', async () => {
    const res = await app.request('/webhooks/meta', { method: 'POST', body: payload })
    expect(res.status).toBe(401)
  })

  it('accepts signed deliveries and hands them to the agent', async () => {
    f.push(say('Hello! Ki dekhte chan?'))
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body: payload,
    })
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 300))
    expect(f.seen).toHaveLength(1)
  })
})
