import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoreApp, openDb } from '@saudaai/demo-store'
import { fakeShopify, shopifyDomain } from '../test/shopify.ts'
import { fakeWoo, wooUrl } from '../test/woocommerce.ts'
import { demoProducts, fakeStore, storeUrl } from '../test/store.ts'
import { testShop } from '../test/shop.ts'
import { connectStore } from './index.ts'
import { externalProduct, storeOrder } from './schema.ts'
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

const kinds: Record<string, () => Setup | Promise<Setup>> = {
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
  'demo-store': async () => {
    const store = createStoreApp(await openDb(':memory:'), { token: 'store-token-1', pageSize: 5 })
    return {
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        store.fetch(new Request(String(input), init))) as typeof fetch,
      connect: async (shop, db) =>
        (
          await connectStore(
            db,
            shop,
            {
              kind: 'custom',
              baseUrl: 'https://demo-store.test',
              credentials: { token: 'store-token-1' },
              webhookSecret: 'whsec',
            },
            Date.now(),
          )
        ).connector!,
      unknownId: 'nope',
      orderLine: 'maroon-kurti-m',
      forged: { headers: { 'x-saudaai-signature': 'sha256=00' }, raw: '[]' },
    }
  },
  woocommerce: () => {
    const woo = fakeWoo()
    return {
      fetch: woo.fetch as typeof fetch,
      connect: async (shop, db) =>
        (
          await connectStore(
            db,
            shop,
            {
              kind: 'woocommerce',
              baseUrl: wooUrl,
              credentials: { consumerKey: 'ck_test', consumerSecret: 'cs_test' },
              webhookSecret: 'wc_secret',
            },
            Date.now(),
          )
        ).connector!,
      unknownId: '999',
      orderLine: '101:201',
      forged: {
        headers: { 'x-wc-webhook-signature': 'AAAA', 'x-wc-webhook-topic': 'product.deleted' },
        raw: '{"id":1}',
      },
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
      setup = await make()
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

    it('reads orders placed on the site', async () => {
      await connector.createOrder({
        customer: { name: 'Mitu Akter', phone: '01711000111', area: 'Mirpur' },
        lines: [{ variantExternalId: setup.orderLine, qty: 1 }],
        shippingPoisha: 6000,
        paymentMethod: 'cod',
        tags: ['saudaai'],
      })
      const { orders } = await connector.listOrders(Date.now() - 365 * 86_400_000)
      expect(orders.length).toBeGreaterThan(0)
      for (const o of orders) expect(() => storeOrder.parse(o)).not.toThrow()
      expect(await connector.getOrder(orders[0]!.externalId)).toEqual(orders[0])
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

  it('subscribes to the webhooks it understands', async () => {
    const { shopify, connector } = await connect()
    await connector.registerWebhooks!('https://saudaai.example/webhooks/store/s1')
    const subs = shopify.ops.filter((o) => o.op === 'webhookSubscriptionCreate')
    expect(subs.map((o) => o.variables.topic)).toContain('INVENTORY_LEVELS_UPDATE')
    expect(subs[0]!.variables.sub).toEqual({
      callbackUrl: 'https://saudaai.example/webhooks/store/s1',
      format: 'JSON',
    })
  })

  it('posts a banner as a blog article', async () => {
    const { shopify, connector } = await connect()
    const { url } = await connector.publishPost!({
      title: 'Eid collection',
      body: 'Notun kurti <3',
      imageUrl: 'https://saudaai.example/media/b1',
    })
    expect(url).toBe(`https://${shopifyDomain}/blogs/news/eid-collection`)
    expect(shopify.ops.find((o) => o.op === 'articleCreate')!.variables).toMatchObject({
      article: {
        blogId: 'gid://shopify/Blog/1',
        image: { url: 'https://saudaai.example/media/b1' },
        isPublished: true,
      },
    })
  })

  it('adjusts stock at the first location', async () => {
    const { shopify, connector } = await connect()
    expect(await connector.adjustStock!('gid://shopify/ProductVariant/9001', 3)).toBe(7)
    expect(shopify.ops.find((o) => o.op === 'inventoryAdjustQuantities')!.variables).toMatchObject({
      input: { changes: [{ delta: 3, inventoryItemId: 'gid://shopify/InventoryItem/42' }] },
    })
  })
})

describe('woocommerce specifics', () => {
  afterEach(() => vi.unstubAllGlobals())
  const sign = (raw: string) => createHmac('sha256', 'wc_secret').update(raw).digest('base64')

  async function connect() {
    const t = await testShop()
    const woo = fakeWoo()
    vi.stubGlobal('fetch', woo.fetch)
    const res = await connectStore(
      t.db,
      t.shop,
      {
        kind: 'woocommerce',
        baseUrl: wooUrl,
        credentials: { consumerKey: 'ck_test', consumerSecret: 'cs_test' },
        webhookSecret: 'wc_secret',
      },
      Date.now(),
    )
    return { woo, connector: res.connector!, row: res.row }
  }

  it('reads variations as sizes and keeps out of stock at zero', async () => {
    const { connector, row } = await connect()
    expect(row.name).toBe("Nusrat's Shop")
    const kurti = await connector.getProduct('101')
    expect(kurti).toMatchObject({
      status: 'active',
      category: 'Kurti',
      variants: [
        { externalId: '101:201', size: 'M', pricePoisha: 150000, stock: 4 },
        { externalId: '101:202', size: 'L', stock: 0 },
      ],
    })
    expect((await connector.getProduct('102'))!.variants[0]).toMatchObject({
      externalId: '102',
      pricePoisha: 49950,
      stock: null,
    })
  })

  it('creates the order on hold and moves it to processing when paid', async () => {
    const { woo, connector } = await connect()
    const made = await connector.createOrder({
      customer: { name: 'Mitu Akter', phone: '01711000111', area: 'Mirpur' },
      lines: [
        { variantExternalId: '101:201', qty: 2 },
        { variantExternalId: '102', qty: 1 },
      ],
      shippingPoisha: 6000,
      paymentMethod: 'bkash',
      tags: ['saudaai', 'webchat'],
    })
    expect(made).toMatchObject({ externalId: '727', number: '727', totalPoisha: 306000 })
    const sent = woo.calls.find((c) => c.method === 'POST' && c.path === '/orders')!.body
    expect(sent).toMatchObject({
      status: 'on-hold',
      set_paid: false,
      line_items: [
        { product_id: 101, variation_id: 201, quantity: 2 },
        { product_id: 102, quantity: 1 },
      ],
      shipping_lines: [{ total: '60.00' }],
      billing: { first_name: 'Mitu', last_name: 'Akter', country: 'BD' },
    })
    await connector.updateOrder('727', { paidPoisha: 306000 })
    expect(woo.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: '/orders/727',
      body: { set_paid: true, status: 'processing' },
    })
  })

  it('creates its webhooks with our secret', async () => {
    const { woo, connector } = await connect()
    await connector.registerWebhooks!('https://saudaai.example/webhooks/store/s1')
    const made = woo.calls.filter((c) => c.method === 'POST' && c.path === '/webhooks')
    expect(made).toHaveLength(5)
    expect(made[0]!.body).toMatchObject({ secret: 'wc_secret', status: 'active' })
  })

  it('ignores the ping, and re-reads the product on a signed update', async () => {
    const { connector } = await connect()
    const ping = 'webhook_id=12'
    expect(
      await connector.parseWebhook({
        headers: { 'x-wc-webhook-signature': sign(ping) },
        raw: ping,
      }),
    ).toEqual([])
    const raw = JSON.stringify({ id: 101, name: 'Indigo Block Print Kurti' })
    const events = await connector.parseWebhook({
      headers: { 'x-wc-webhook-signature': sign(raw), 'x-wc-webhook-topic': 'product.updated' },
      raw,
    })
    expect(events[0]).toMatchObject({
      type: 'product.upsert',
      product: { externalId: '101', variants: [{}, {}] },
    })
  })

  it('refuses plain http store urls at the api', async () => {
    const { storeConnect } = await import('@saudaai/shared')
    expect(
      storeConnect.safeParse({
        kind: 'woocommerce',
        baseUrl: 'http://shop.example',
        consumerKey: 'ck_x',
        consumerSecret: 'cs_x',
      }).success,
    ).toBe(false)
  })
})

describe('custom store writes', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function connectDemo() {
    const t = await testShop()
    const store = createStoreApp(await openDb(':memory:'), { token: 'store-token-1' })
    vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) =>
      store.fetch(new Request(String(input), init))) as typeof fetch)
    const { connector } = await connectStore(
      t.db,
      t.shop,
      {
        kind: 'custom',
        baseUrl: 'https://demo-store.test',
        credentials: { token: 'store-token-1' },
      },
      Date.now(),
    )
    return connector!
  }

  it('creates and publishes a product with its photo on the demo store', async () => {
    const connector = await connectDemo()
    const made = await connector.createProduct!({
      name: 'Olive Cotton Panjabi',
      category: 'panjabi',
      imageUrl: 'https://saudaai.example/media/abc',
      status: 'draft',
      variants: [
        { externalId: '', size: 'M', pricePoisha: 180000, stock: 4 },
        { externalId: '', size: 'L', pricePoisha: 180000, stock: 4 },
      ],
    })
    expect(made).toMatchObject({ status: 'draft', imageUrl: 'https://saudaai.example/media/abc' })
    expect(made.variants.map((v) => v.size)).toEqual(['M', 'L'])
    await connector.publishProduct!(made.externalId)
    expect((await connector.getProduct(made.externalId))!.status).toBe('active')
  })

  it('changes stock on the demo store and refuses untracked items', async () => {
    const connector = await connectDemo()
    expect(await connector.adjustStock!('maroon-kurti-m', 3)).toBe(7)
    expect(await connector.adjustStock!('maroon-kurti-m', -10)).toBe(0)
    await expect(connector.adjustStock!('nope', 1)).rejects.toMatchObject({ status: 404 })
  })

  it('publishes a banner post that shows on the demo store home page', async () => {
    const t = await testShop()
    const app = createStoreApp(await openDb(':memory:'), { token: 'store-token-1' })
    vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) =>
      app.fetch(new Request(String(input), init))) as typeof fetch)
    const { connector } = await connectStore(
      t.db,
      t.shop,
      {
        kind: 'custom',
        baseUrl: 'https://demo-store.test',
        credentials: { token: 'store-token-1' },
      },
      Date.now(),
    )
    const { url } = await connector!.publishPost!({
      title: 'Eid collection',
      body: 'Notun kurti esheche',
      imageUrl: 'https://saudaai.example/media/banner1',
    })
    expect(url).toMatch(/#post-/)
    const home = await (await app.request('/')).text()
    expect(home).toContain('src="https://saudaai.example/media/banner1"')
    expect(home).toContain('Notun kurti esheche')
  })

  it('reports a site without the optional routes as not supported', async () => {
    const t = await testShop()
    vi.stubGlobal('fetch', fakeStore(demoProducts()).fetch)
    const { connector } = await connectStore(
      t.db,
      t.shop,
      { kind: 'custom', baseUrl: storeUrl, credentials: { token: 'tok-12345678' } },
      Date.now(),
    )
    await expect(connector!.adjustStock!('v1', 1)).rejects.toMatchObject({ status: 404 })
    await expect(
      connector!.publishPost!({ title: 't', body: 'b', imageUrl: 'https://x.example/i' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
