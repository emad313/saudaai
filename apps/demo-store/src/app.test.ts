import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoreApp } from './app.ts'
import { openDb } from './db.ts'

const auth = { authorization: 'Bearer store-token-1', 'content-type': 'application/json' }
const linked = { url: 'https://saudaai.test', shopId: 'shop1', webhookSecret: 'whsec' }
let app: ReturnType<typeof createStoreApp>
let hooks: { url: string; body: string; sig: string }[]

beforeEach(async () => {
  const db = await openDb(`file:${join(mkdtempSync(join(tmpdir(), 'store-')), 's.db')}`)
  app = createStoreApp(db, { token: 'store-token-1', saudaai: linked })
  hooks = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    hooks.push({
      url,
      body: String(init.body),
      sig: (init.headers as Record<string, string>)['x-saudaai-signature']!,
    })
    return new Response('ok')
  })
})
afterEach(() => vi.unstubAllGlobals())

const get = (path: string) => app.request(path, { headers: auth })
const order = (lines: { variantExternalId: string; qty: number }[]) =>
  app.request('/saudaai/orders', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      customer: { name: 'Mitu' },
      lines,
      shippingPoisha: 6000,
      paymentMethod: 'cod',
      tags: ['saudaai'],
    }),
  })

describe('store api', () => {
  it('needs the bearer token', async () => {
    expect((await app.request('/saudaai/info')).status).toBe(401)
    expect(await (await get('/saudaai/info')).json()).toEqual({
      name: "SaudaAI Demo Shop",
      currency: 'BDT',
    })
  })

  it('pages the catalog with a cursor', async () => {
    const first = (await (await get('/saudaai/products')).json()) as {
      products: unknown[]
      next: string
    }
    const second = (await (await get(`/saudaai/products?cursor=${first.next}`)).json()) as {
      products: unknown[]
      next?: string
    }
    expect(first.products).toHaveLength(10)
    expect(second.products).toHaveLength(2)
    expect(second.next).toBeUndefined()
    expect((await get('/saudaai/products/nope')).status).toBe(404)
  })

  it('prices orders from its own catalog, takes stock and tells saudaai', async () => {
    const res = await order([{ variantExternalId: 'maroon-kurti-m', qty: 2 }])
    expect(await res.json()).toMatchObject({ number: 'NC-1001', totalPoisha: 2 * 125000 + 6000 })
    const p = (await (await get('/saudaai/products/maroon-kurti')).json()) as {
      variants: { externalId: string; stock: number }[]
    }
    expect(p.variants.find((v) => v.externalId === 'maroon-kurti-m')!.stock).toBe(2)
    await vi.waitFor(() => expect(hooks).toHaveLength(1))
    expect(hooks[0]!.url).toBe('https://saudaai.test/webhooks/store/shop1')
    expect(hooks[0]!.sig).toBe(
      `sha256=${createHmac('sha256', 'whsec').update(hooks[0]!.body).digest('hex')}`,
    )
    expect(JSON.parse(hooks[0]!.body)).toEqual([
      { type: 'stock', variantExternalId: 'maroon-kurti-m', stock: 2 },
    ])
  })

  it('refuses to oversell and leaves stock alone', async () => {
    const res = await order([{ variantExternalId: 'leather-bag-brown', qty: 4 }])
    expect(res.status).toBe(409)
    const p = (await (await get('/saudaai/products/leather-bag')).json()) as {
      variants: { stock: number }[]
    }
    expect(p.variants[0]!.stock).toBe(3)
  })

  it('puts stock back when an order is cancelled, once', async () => {
    const made = (await (await order([{ variantExternalId: 'navy-kurti-m', qty: 1 }])).json()) as {
      externalId: string
    }
    for (let i = 0; i < 2; i++) {
      await app.request(`/saudaai/orders/${made.externalId}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ status: 'cancelled', note: 'customer changed mind' }),
      })
    }
    const p = (await (await get('/saudaai/products/navy-kurti')).json()) as {
      variants: { externalId: string; stock: number }[]
    }
    expect(p.variants.find((v) => v.externalId === 'navy-kurti-m')!.stock).toBe(3)
  })

  it('sends a product update when the owner edits price in admin', async () => {
    const form = new URLSearchParams({ id: 'jersey-hijab-black', taka: '380', stock: '11' })
    const res = await app.request('/admin/variant?key=store-token-1', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    expect(res.status).toBe(302)
    const [event] = JSON.parse(hooks[0]!.body)
    expect(event.type).toBe('product.upsert')
    expect(event.product.variants[0]).toMatchObject({
      externalId: 'jersey-hijab-black',
      pricePoisha: 38000,
      stock: 11,
    })
  })

  it('sends a website checkout to saudaai as an order event and lists it with prices', async () => {
    const form = new URLSearchParams({
      variant: 'green-threepiece-l',
      qty: '1',
      name: 'Sadia Islam',
      phone: '01722000333',
      address: 'Agrabad Road 3',
      area: 'Chattogram',
      zone: 'outside',
      payment: 'cod',
    })
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    expect(await res.text()).toContain('NC-1001')
    await vi.waitFor(() => expect(hooks.length).toBeGreaterThanOrEqual(2))
    const events = hooks.flatMap((h) => JSON.parse(h.body))
    const placed = events.find((e: { type: string }) => e.type === 'order.upsert')
    expect(placed).toMatchObject({ status: 'confirmed' })

    const listed = (await (await get('/saudaai/orders?since=0')).json()) as {
      orders: { externalId: string; totalPoisha: number; lines: unknown[] }[]
    }
    expect(listed.orders[0]).toMatchObject({
      externalId: placed.externalId,
      totalPoisha: 185000 + 12000,
      lines: [
        {
          variantExternalId: 'green-threepiece-l',
          productExternalId: 'green-threepiece',
          qty: 1,
          unitPricePoisha: 185000,
        },
      ],
    })
  })

  it('renders the site with the widget for the product being viewed', async () => {
    const withWidget = createStoreApp(await openDb(':memory:'), {
      token: 'store-token-1',
      saudaai: { ...linked, publicKey: 'pk123' },
    })
    const html = await (await withWidget.request('/p/maroon-kurti')).text()
    expect(html).toContain('src="https://saudaai.test/widget.js"')
    expect(html).toContain('data-shop="pk123" data-product="maroon-kurti"')
  })
})
