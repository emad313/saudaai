import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTurn } from '../agent/loop.ts'
import { products } from '../db/schema.ts'
import { call, calls, fakeDeps, say } from '../test/deps.ts'
import { chat, testShop } from '../test/shop.ts'
import { demoProducts, fakeStore, storeUrl } from '../test/store.ts'
import { connectStore } from '../stores/index.ts'
import { applyProduct, pullStore } from '../stores/sync.ts'
import { productImage } from './image.ts'

let t: Awaited<ReturnType<typeof testShop>>
let fetched: string[]

beforeEach(async () => {
  t = await testShop()
  fetched = []
  const site = fakeStore(
    demoProducts().map((p) => ({ ...p, imageUrl: `https://cdn.example/${p.externalId}.png` })),
  )
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#1a8cf0' } })
    .png()
    .toBuffer()
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://cdn.example/')) {
      fetched.push(url)
      return url.endsWith('broken.png')
        ? new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } })
        : new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
    }
    return site.fetch(input, init)
  })
  const { row, connector } = await connectStore(
    t.db,
    t.shop,
    { kind: 'custom', baseUrl: storeUrl, credentials: { token: 'tok-12345678' } },
    t.ctx().now,
  )
  await pullStore(t.db, row, connector!, t.ctx().now)
})
afterEach(() => vi.unstubAllGlobals())

const kurti = async () =>
  (await t.db.select().from(products).where(eq(products.externalId, 'p1')))[0]!

describe('store product images', () => {
  it('downloads the store image once and reuses it', async () => {
    const first = await productImage(t.db, await kurti())
    const again = await productImage(t.db, await kurti())
    expect(first?.mime).toBe('image/jpeg')
    expect(again?.id).toBe(first?.id)
    expect(fetched).toEqual(['https://cdn.example/p1.png'])
  })

  it('refuses something that is not an image', async () => {
    await t.db
      .update(products)
      .set({ imageUrl: 'https://cdn.example/broken.png' })
      .where(eq(products.externalId, 'p1'))
    expect(await productImage(t.db, await kurti())).toBeNull()
  })

  it('takes the new photo when the store changes it', async () => {
    const before = await productImage(t.db, await kurti())
    const [store] = await t.db.select().from((await import('../db/schema.ts')).stores)
    await applyProduct(
      t.db,
      store!,
      { ...demoProducts()[0]!, imageUrl: 'https://cdn.example/p1-new.png' },
      t.ctx().now,
    )
    expect((await kurti()).imageId).toBeNull()
    await productImage(t.db, await kurti())
    expect(fetched.at(-1)).toBe('https://cdn.example/p1-new.png')
    expect(before).not.toBeNull()
  })

  it('sends the store photo when a customer asks to see it', async () => {
    const p = await kurti()
    const f = fakeDeps(t.db, [
      calls(call('send_product_photo', { productId: p.id })),
      say('Ei je chobi.'),
    ])
    const conv = await chat(t.db, t.shop.id, 'kurti tar chobi dekhan')
    await runTurn(f.deps, {
      shop: t.shop,
      actor: 'customer',
      conversation: conv,
      inputKind: 'text',
    })
    expect(f.sent[0]!.msg).toMatchObject({
      kind: 'image',
      caption: 'Indigo Block Print Kurti - ৳1,500',
    })
  })
})
