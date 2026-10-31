import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeShopify, shopifyDomain } from '../test/shopify.ts'
import { demoProducts, fakeStore, storeUrl } from '../test/store.ts'
import { testShop } from '../test/shop.ts'
import { connectStore } from './index.ts'
import { externalProduct } from './schema.ts'
import type { StoreConnector } from './types.ts'

type Setup = {
  fetch: typeof fetch
  connect: (
    shop: { id: string; name: string },
    db: Awaited<ReturnType<typeof testShop>>['db'],
  ) => Promise<StoreConnector>
  unknownId: string
  orderLine: string
  forged: { headers: Record<string, string>; raw: string }
}

const kinds: Record<string, () => Setup> = {
  custom: () => {
    const site = fakeStore(demoProducts())
    return {
      fetch: site.fetch as typeof fetch,
      connect: async (shop, db) =>
        (
          await connectStore(
            db,
            shop,
            {
              kind: 'custom',
              baseUrl: storeUrl,
              credentials: { token: 'tok-12345678' },
              webhookSecret: 'whsec',
            },
            Date.now(),
          )
        ).connector!,
      unknownId: 'nope',
      orderLine: 'v1',
      forged: { headers: { 'x-saudaai-signature': 'sha256=00' }, raw: '[]' },
    }
  },
  shopify: () => {
    const shopify = fakeShopify()
    return {
      fetch: shopify.fetch as typeof fetch,
      connect: async (shop, db) =>
        (
          await connectStore(
            db,
            shop,
            {
              kind: 'shopify',
              baseUrl: `https://${shopifyDomain}`,
              credentials: { accessToken: 'shpat_test_token' },
              webhookSecret: 'shpss_app_secret',
            },
            Date.now(),
          )
        ).connector!,
      unknownId: 'gid://shopify/Product/1',
      orderLine: 'gid://shopify/ProductVariant/9001',
      forged: {
        headers: { 'x-shopify-hmac-sha256': 'AAAA', 'x-shopify-topic': 'products/delete' },
        raw: '{"id":1}',
      },
    }
  },
}

for (const [kind, make] of Object.entries(kinds)) {
  describe(`${kind} connector contract`, () => {
    let setup: Setup
    let connector: StoreConnector

    beforeEach(async () => {
      const t = await testShop()
      setup = make()
      vi.stubGlobal('fetch', setup.fetch)
      connector = await setup.connect(t.shop, t.db)
    })
    afterEach(() => vi.unstubAllGlobals())

    it('reports a BDT store', async () => {
      expect(await connector.test()).toMatchObject({ ok: true, currency: 'BDT' })
    })

    it('pages through valid products and finds them by id', async () => {
      const all = []
      let cursor: string | undefined
      do {
        const page = await connector.listProducts(cursor)
        all.push(...page.products)
        cursor = page.next
      } while (cursor)
      expect(all.length).toBeGreaterThanOrEqual(2)
      for (const p of all) {
        expect(() => externalProduct.parse(p)).not.toThrow()
        for (const v of p.variants) expect(Number.isInteger(v.pricePoisha)).toBe(true)
      }
      expect(await connector.getProduct(all[0]!.externalId)).toEqual(all[0])
      expect(await connector.getProduct(setup.unknownId)).toBeNull()
    })

    it('creates and updates an order', async () => {
      const made = await connector.createOrder({
        customer: { name: 'Mitu Akter', phone: '01711000111', address: 'Road 4', area: 'Mirpur' },
        lines: [{ variantExternalId: setup.orderLine, qty: 2 }],
        shippingPoisha: 6000,
        paymentMethod: 'cod',
        tags: ['saudaai', 'messenger'],
      })
      expect(made.externalId).toBeTruthy()
      expect(made.number).toBeTruthy()
      expect(Number.isInteger(made.totalPoisha)).toBe(true)
      await connector.updateOrder(made.externalId, { status: 'shipped' })
      await connector.updateOrder(made.externalId, {
        paidPoisha: made.totalPoisha,
        note: 'paid by bkash',
      })
      await connector.updateOrder(made.externalId, { status: 'cancelled' })
    })

    it('rejects a forged webhook', async () => {
      await expect(connector.parseWebhook(setup.forged)).rejects.toThrow('signature')
    })
  })
}

describe('shopify specifics', () => {
  afterEach(() => vi.unstubAllGlobals())
  const sign = (raw: string) =>
    createHmac('sha256', 'shpss_app_secret').update(raw).digest('base64')

  async function connect(opts: Parameters<typeof fakeShopify>[0] = {}) {
    const t = await testShop()
    const shopify = fakeShopify(opts)
    vi.stubGlobal('fetch', shopify.fetch)
    const res = await connectStore(
      t.db,
      t.shop,
      {
        kind: 'shopify',
        baseUrl: `https://${shopifyDomain}`,
        credentials: { accessToken: 'shpat_test_token' },
        webhookSecret: 'shpss_app_secret',
      },
      Date.now(),
    )
    return { shopify, connector: res.connector! }
  }

  it('maps options, untracked inventory and decimal prices without floats', async () => {
    const { connector } = await connect()
    const second = await connector.listProducts('cursor')
    expect(second.products[0]!.variants[0]).toMatchObject({ pricePoisha: 49950, stock: null })
    const first = await connector.listProducts()
    expect(first.products[0]!.variants[0]).toMatchObject({
      size: 'M',
      color: 'Indigo',
      pricePoisha: 150000,
      stock: 4,
    })
  })

  it('backs off when throttled', async () => {
    const { shopify, connector } = await connect({ throttleFirst: true })
    expect(await connector.test()).toMatchObject({ ok: true })
    expect(shopify.ops.filter((o) => o.op === 'shop {').length).toBeGreaterThanOrEqual(1)
  })

  it('refuses a non BDT store', async () => {
    const t = await testShop()
    vi.stubGlobal('fetch', fakeShopify({ currency: 'USD' }).fetch)
    await expect(
      connectStore(
        t.db,
        t.shop,
        {
          kind: 'shopify',
          baseUrl: `https://${shopifyDomain}`,
          credentials: { accessToken: 'shpat_test_token' },
        },
        Date.now(),
      ),
    ).rejects.toThrow('only BDT')
  })

  it('creates the order as a draft completed with payment pending', async () => {
    const { shopify, connector } = await connect()
    const made = await connector.createOrder({
      customer: { name: 'Mitu Akter', area: 'Mirpur' },
      lines: [{ variantExternalId: 'gid://shopify/ProductVariant/9001', qty: 2 }],
      shippingPoisha: 6000,
      paymentMethod: 'bkash',
      tags: ['saudaai', 'whatsapp'],
    })
    expect(made).toMatchObject({
      number: '#1001',
      totalPoisha: 306000,
      adminUrl: `https://${shopifyDomain}/admin/orders/5551`,
    })
    const draft = shopify.ops.find((o) => o.op === 'draftOrderCreate')!.variables.input as Record<
      string,
      unknown
    >
    expect(draft).toMatchObject({
      lineItems: [{ variantId: 'gid://shopify/ProductVariant/9001', quantity: 2 }],
      shippingLine: { priceWithCurrency: { amount: '60.00', currencyCode: 'BDT' } },
      tags: ['saudaai', 'whatsapp'],
    })
  })

  it('turns signed webhooks into store events', async () => {
    const { connector } = await connect()
    const product = JSON.stringify(
      (await import('../test/fixtures/shopify/webhook-products-update.json')).default,
    )
    const events = await connector.parseWebhook({
      headers: { 'x-shopify-hmac-sha256': sign(product), 'x-shopify-topic': 'products/update' },
      raw: product,
    })
    expect(events[0]).toMatchObject({
      type: 'product.upsert',
      product: {
        externalId: 'gid://shopify/Product/8001',
        variants: [{ pricePoisha: 145000, stock: 3, size: 'M' }, {}],
      },
    })

    const order = JSON.stringify(
      (await import('../test/fixtures/shopify/webhook-orders-updated.json')).default,
    )
    expect(
      await connector.parseWebhook({
        headers: { 'x-shopify-hmac-sha256': sign(order), 'x-shopify-topic': 'orders/updated' },
        raw: order,
      }),
    ).toEqual([
      {
        type: 'order.upsert',
        externalId: 'gid://shopify/Order/5551',
        status: 'shipped',
        paidPoisha: 306000,
      },
    ])

    const level = JSON.stringify({ inventory_item_id: 42, available: 7 })
    expect(
      await connector.parseWebhook({
        headers: {
          'x-shopify-hmac-sha256': sign(level),
          'x-shopify-topic': 'inventory_levels/update',
        },
        raw: level,
      }),
    ).toEqual([{ type: 'stock', variantExternalId: 'gid://shopify/ProductVariant/9002', stock: 7 }])
  })

  it('adjusts stock at the first location', async () => {
    const { shopify, connector } = await connect()
    expect(await connector.adjustStock!('gid://shopify/ProductVariant/9001', 3)).toBe(7)
    expect(shopify.ops.find((o) => o.op === 'inventoryAdjustQuantities')!.variables).toMatchObject({
      input: { changes: [{ delta: 3, inventoryItemId: 'gid://shopify/InventoryItem/42' }] },
    })
  })
})
