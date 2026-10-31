import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTelegram } from '../channels/telegram.ts'
import { loginCodes } from '../db/schema.ts'
import { createInbox } from '../inbox.ts'
import { call, calls, fakeDeps, say } from '../test/deps.ts'
import { now, testShop } from '../test/shop.ts'
import { demoProducts, fakeStore, storeUrl } from '../test/store.ts'
import { listOrders } from '../tools/orders.ts'
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

describe('website widget', () => {
  const key = () => t.shop.publicKey!
  const sid = 'abcdefghijklmnopqrstuvwx'

  it('answers the cors preflight from any site', async () => {
    const res = await app.request(`/api/w/${key()}/messages`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://some-shop.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-saudaai-session',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toContain('x-saudaai-session')
  })

  it('issues a session and refuses messages without one', async () => {
    expect((await app.request('/api/w/not-a-key')).status).toBe(404)
    const info = await (await app.request(`/api/w/${key()}`)).json()
    expect(info).toMatchObject({ name: "Nusrat's Closet" })
    expect(info.session).toMatch(/^[a-z0-9]{24}$/)
    const res = await app.request(`/api/w/${key()}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(res.status).toBe(400)
  })

  it('tells the agent which product page the customer is on and keeps chats apart', async () => {
    f = fakeDeps(t.db, [say('Ji, M size ache.')])
    const inbox = createInbox(f.deps)
    app = createApp({ db: t.db, deps: f.deps, inbox, telegram: createTelegram(t.db) })
    const { matches } = await findProducts(t.ctx(), { query: 'maroon kurti' })
    const res = await app.request(`/api/w/${key()}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-saudaai-session': sid },
      body: JSON.stringify({
        text: 'eta M size ache?',
        pageUrl: 'https://nusrats-closet.example/p/maroon-kurti',
        productId: matches[0]!.productId,
      }),
    })
    expect(res.status).toBe(202)
    await inbox.idle()
    const system = String(f.seen[0]!.messages[0]!.content)
    expect(system).toContain(`looking at this product page: ${matches[0]!.productId}`)

    const mine = await (
      await app.request(`/api/w/${key()}/messages`, { headers: { 'x-saudaai-session': sid } })
    ).json()
    expect(mine.messages.map((m: { role: string }) => m.role)).toEqual(['customer', 'agent'])
    const other = await (
      await app.request(`/api/w/${key()}/messages`, {
        headers: { 'x-saudaai-session': 'zyxwvutsrqponmlkjihgfedc' },
      })
    ).json()
    expect(other.messages).toEqual([])
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

  it('takes instagram dms on the same webhook and answers on instagram', async () => {
    f.push(say('Ji, bolun ki lagbe?'))
    const ig = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'IG_ID',
          messaging: [
            {
              sender: { id: 'IGSID1' },
              recipient: { id: 'IG_ID' },
              timestamp: now,
              message: { mid: 'ig.mid.1', text: 'price koto?' },
            },
          ],
        },
      ],
    })
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'test-secret').update(ig).digest('hex')}`,
      },
      body: ig,
    })
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 300))
    expect(f.sent.at(-1)!.conversation).toMatchObject({
      channel: 'instagram',
      externalUserId: 'IGSID1',
    })
  })
})

describe('store api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('connects a custom store, never returns the token, and takes signed webhooks', async () => {
    const cookie = await signIn()
    const site = fakeStore(demoProducts())
    vi.stubGlobal('fetch', site.fetch)
    const put = await app.request('/api/store', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'custom', baseUrl: storeUrl, token: 'tok-wrong' }),
    })
    expect(put.status).toBe(400)

    site.requests.length = 0
    const ok = await app.request('/api/store', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'custom', baseUrl: storeUrl, token: 'tok-12345678' }),
    })
    expect(ok.status).toBe(200)
    const view = (await ok.json()) as { webhookSecret: string; webhookUrl: string }
    expect(JSON.stringify(view)).not.toContain('tok-12345678')
    expect(view).toMatchObject({ kind: 'custom', name: 'Demo Site', status: 'connected' })
    expect(view.webhookUrl).toContain(`/webhooks/store/${t.shop.id}`)
    expect(site.requests).toContain('GET /saudaai/products')

    const raw = JSON.stringify([{ type: 'product.delete', externalId: 'p1' }])
    const hook = (sig: string) =>
      app.request(`/webhooks/store/${t.shop.id}`, {
        method: 'POST',
        headers: { 'x-saudaai-signature': sig, 'content-type': 'application/json' },
        body: raw,
      })
    expect((await hook('sha256=00')).status).toBe(401)
    const signed = createHmac('sha256', view.webhookSecret).update(raw).digest('hex')
    expect((await hook(`sha256=${signed}`)).status).toBe(200)
    expect((await findProducts(t.ctx(), { query: 'kurti' })).matches).toEqual([])

    const back = await app.request('/api/store', { method: 'DELETE', headers: { cookie } })
    expect(await back.json()).toMatchObject({ kind: 'builtin' })
    expect((await findProducts(t.ctx(), { query: 'kalo tshirt' })).matches.length).toBeGreaterThan(
      0,
    )
  })
})

describe('command box', () => {
  it('runs the seller agent and answers inline, approvals still reach telegram', async () => {
    const [draft] = await listOrders(t.ctx(), { status: ['draft'] })
    f = fakeDeps(t.db, [
      calls(call('send_order_confirmation', { orderId: draft!.orderId })),
      say(`#${draft!.number} confirm korte approve din.`),
    ])
    const inbox = createInbox(f.deps)
    app = createApp({ db: t.db, deps: f.deps, inbox, telegram: createTelegram(t.db) })
    const cookie = await signIn()
    const res = await app.request('/api/command', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${draft!.number} confirm koro` }),
    })
    const out = await res.json()
    expect(out.replies[0].text).toContain(`#${draft!.number} confirm korte approve din.`)
    expect(out.pending).toHaveLength(1)
    expect(out.pending[0]).toMatchObject({ tool: 'send_order_confirmation', status: 'pending' })
    expect(f.approvals.map((a) => a.id)).toEqual([out.pending[0].id])
    expect(f.notes).toEqual([])
  })
})
