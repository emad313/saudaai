import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orders, products } from '../db/schema.ts'
import { demoProducts, fakeStore, storeUrl } from '../test/store.ts'
import { testShop } from '../test/shop.ts'
import { createCustomer } from '../tools/customers.ts'
import { createOrder, recordPayment, updateOrderStatus } from '../tools/orders.ts'
import { adjustStock, findProducts } from '../tools/products.ts'
import { connectStore, storeFor } from './index.ts'
import { applyEvents, pullStore } from './sync.ts'

let t: Awaited<ReturnType<typeof testShop>>
let site: ReturnType<typeof fakeStore>

async function connect(opts: { totalOffset?: number } = {}) {
  site = fakeStore(demoProducts(), opts)
  vi.stubGlobal('fetch', site.fetch)
  const { row, connector } = await connectStore(
    t.db,
    t.shop,
    {
      kind: 'custom',
      baseUrl: storeUrl,
      credentials: { token: 'tok-12345678' },
      webhookSecret: 'whsec',
    },
    t.ctx().now,
  )
  await pullStore(t.db, row, connector!, t.ctx().now)
  return row
}

async function variant(query: string, size?: string) {
  const { matches } = await findProducts(t.ctx(), { query })
  return matches[0]!.variants.find((v) => !size || v.size === size)!
}

async function customer() {
  return createCustomer(t.ctx(), { name: 'Mitu', phone: '01711000111', area: 'Mirpur' })
}

beforeEach(async () => {
  t = await testShop()
})
afterEach(() => vi.unstubAllGlobals())

describe('connected custom store', () => {
  it('tests the connection, syncs, and shows only store products', async () => {
    const row = await connect()
    expect(row).toMatchObject({ kind: 'custom', name: 'Demo Site', status: 'connected' })
    expect(row.credentials).not.toContain('tok')
    expect((await findProducts(t.ctx(), { query: 'kurti' })).matches.map((m) => m.name)).toEqual([
      'Indigo Block Print Kurti',
    ])
    expect((await findProducts(t.ctx(), { query: 'kalo tshirt' })).matches).toEqual([])
    expect((await variant('tote')).available).toBeNull()
  })

  it('refuses to save a store whose test fails', async () => {
    vi.stubGlobal('fetch', fakeStore([]).fetch)
    await expect(
      connectStore(
        t.db,
        t.shop,
        { kind: 'custom', baseUrl: storeUrl, credentials: { token: 'wrong' } },
        t.ctx().now,
      ),
    ).rejects.toThrow('401')
    expect((await storeFor(t.db, t.shop.id)).row).toBeNull()
  })

  it('uses the live store price, not the synced one', async () => {
    await connect()
    const v = await variant('kurti', 'M')
    site.products[0]!.variants[0]!.pricePoisha = 165000
    const c = await customer()
    const order = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: v.variantId, qty: 1 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'cod',
      source: 'seller_text',
    })
    expect(order.totalPoisha).toBe(165000 + 6000)
    expect(site.requests).toContain('GET /saudaai/products/p1')
  })

  it('refuses when the store has run out since the last sync', async () => {
    await connect()
    const v = await variant('kurti', 'L')
    site.products[0]!.variants[1]!.stock = 0
    const c = await customer()
    await expect(
      createOrder(t.ctx(), {
        customerId: c.customerId,
        lines: [{ variantId: v.variantId, qty: 1 }],
        deliveryArea: 'Mirpur',
        paymentMethod: 'cod',
        source: 'seller_text',
      }),
    ).rejects.toMatchObject({ code: 'out_of_stock' })
  })

  it('archives a product the store no longer has', async () => {
    await connect()
    const v = await variant('tote')
    site.products.splice(1, 1)
    const c = await customer()
    await expect(
      createOrder(t.ctx(), {
        customerId: c.customerId,
        lines: [{ variantId: v.variantId, qty: 1 }],
        deliveryArea: 'Mirpur',
        paymentMethod: 'cod',
        source: 'seller_text',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await findProducts(t.ctx(), { query: 'tote' })).matches).toEqual([])
  })

  it('creates the store order only on confirm, then keeps it in step', async () => {
    await connect()
    const v = await variant('kurti', 'M')
    const c = await customer()
    const draft = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: v.variantId, qty: 2 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'bkash',
      source: 'seller_voice',
    })
    expect(site.orders).toHaveLength(0)

    const confirmed = await updateOrderStatus(t.ctx(), {
      orderId: draft.orderId,
      status: 'confirmed',
    })
    expect(site.orders[0]).toMatchObject({
      lines: [{ variantExternalId: 'v1', qty: 2 }],
      shippingPoisha: 6000,
      tags: ['saudaai', 'seller_voice'],
    })
    expect(confirmed).toMatchObject({
      externalNumber: 'D-101',
      adminUrl: `${storeUrl}/admin/orders/o1`,
    })
    expect('storeWarning' in confirmed).toBe(false)

    await recordPayment(t.ctx(), { orderId: draft.orderId, amountPoisha: 100000, method: 'bkash' })
    await updateOrderStatus(t.ctx(), { orderId: draft.orderId, status: 'shipped' })
    expect(site.changes.map((c) => c.change)).toEqual([
      { paidPoisha: 100000, note: 'SaudaAI: ৳1,000 received by bkash' },
      { status: 'shipped' },
    ])
  })

  it('flags a store total that differs from ours', async () => {
    await connect({ totalOffset: 5000 })
    const v = await variant('kurti', 'M')
    const c = await customer()
    const draft = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: v.variantId, qty: 1 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'cod',
      source: 'seller_text',
    })
    const confirmed = await updateOrderStatus(t.ctx(), {
      orderId: draft.orderId,
      status: 'confirmed',
    })
    expect(confirmed).toMatchObject({ storeWarning: expect.stringContaining('differs') })
  })

  it('leaves stock changes to the store when it cannot adjust them', async () => {
    await connect()
    const v = await variant('kurti', 'M')
    await expect(
      adjustStock(t.ctx(), { variantId: v.variantId, delta: 3, reason: 'new lot' }),
    ).rejects.toMatchObject({ code: 'in_store' })
  })
})

describe('store webhooks', () => {
  const sign = (raw: string) => `sha256=${createHmac('sha256', 'whsec').update(raw).digest('hex')}`

  it('rejects an unsigned or wrongly signed body', async () => {
    await connect()
    const { connector } = await storeFor(t.db, t.shop.id)
    const raw = JSON.stringify([{ type: 'stock', variantExternalId: 'v1', stock: 0 }])
    await expect(connector!.parseWebhook({ headers: {}, raw })).rejects.toThrow('signature')
    await expect(
      connector!.parseWebhook({ headers: { 'x-saudaai-signature': sign(`${raw} `) }, raw }),
    ).rejects.toThrow('signature')
  })

  it('applies stock, product and order events idempotently', async () => {
    const row = await connect()
    const v = await variant('kurti', 'M')
    const c = await customer()
    const draft = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: v.variantId, qty: 1 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'cod',
      source: 'seller_text',
    })
    await updateOrderStatus(t.ctx(), { orderId: draft.orderId, status: 'confirmed' })

    const { connector } = await storeFor(t.db, t.shop.id)
    const raw = JSON.stringify([
      { type: 'stock', variantExternalId: 'v1', stock: 9 },
      { type: 'product.delete', externalId: 'p2' },
      { type: 'order.upsert', externalId: 'o1', status: 'delivered', paidPoisha: 156000 },
      { type: 'order.upsert', externalId: 'unknown', status: 'shipped' },
    ])
    const events = await connector!.parseWebhook({
      headers: { 'x-saudaai-signature': sign(raw) },
      raw,
    })
    await applyEvents(t.db, row, events, t.ctx().now)
    await applyEvents(t.db, row, events, t.ctx().now)

    expect((await variant('kurti', 'M')).available).toBe(9)
    const [tote] = await t.db.select().from(products).where(eq(products.externalId, 'p2'))
    expect(tote!.status).toBe('archived')
    const [o] = await t.db.select().from(orders).where(eq(orders.id, draft.orderId))
    expect(o).toMatchObject({ status: 'delivered', paymentStatus: 'paid', paidPoisha: 156000 })
  })
})
