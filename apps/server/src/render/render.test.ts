import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processProductPhoto } from '../catalog/photo.ts'
import { createOrder } from '../tools/orders.ts'
import { createProductDraft, findProducts, setProductStatus } from '../tools/products.ts'
import { fakeDeps } from '../test/deps.ts'
import { testShop } from '../test/shop.ts'
import { headlineFor, offerPrice, renderAds } from './ad.ts'
import { closeBrowser } from './browser.ts'
import { renderInvoice } from './invoice.ts'

let t: Awaited<ReturnType<typeof testShop>>

beforeAll(async () => {
  t = await testShop()
})
afterAll(closeBrowser)

describe('offers', () => {
  it('computes the sale price in whole taka', () => {
    expect(offerPrice(125000, '10% off')).toBe(112500)
    expect(offerPrice(45000, '১৫% ছাড়')).toBe(38300)
    expect(offerPrice(45000, 'free delivery')).toBeNull()
  })

  it('picks a Bangla headline for the occasion', () => {
    expect(headlineFor('eid')).toBe('ঈদ স্পেশাল')
    expect(headlineFor(undefined)).toBe('নতুন কালেকশন')
  })
})

describe('rendering', () => {
  it('renders an invoice image', async () => {
    const { matches } = await findProducts(t.ctx(), { query: 'maroon kurti' })
    const order = await createOrder(t.ctx(), {
      customerId: (await t.db.query.customers.findFirst())!.id,
      lines: [{ variantId: matches[0]!.variants[0]!.variantId, qty: 2 }],
      deliveryArea: 'Mirpur',
      paymentMethod: 'bkash',
      source: 'seller_text',
    })
    const media = await renderInvoice(t.db, t.shop, order.orderId)
    expect(media.mime).toBe('image/png')
    expect(media.width).toBe(800)
  }, 30_000)

  it('turns a photo into catalog images and ads', async () => {
    const photo = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#7f1d1d' },
    })
      .jpeg()
      .toBuffer()
    const f = fakeDeps(t.db)
    const shot = await processProductPhoto(f.deps, photo, 'eta 1250 taka')
    expect(shot.cutout.width).toBe(1080)
    const draft = await createProductDraft(t.ctx(), {
      name: 'Maroon Party Kurti',
      category: 'kurti',
      pricePoisha: 125000,
      variants: [{ size: 'M', stock: 3 }],
      mediaId: shot.cutout.id,
    })
    await setProductStatus(t.ctx(), { productId: draft.productId, status: 'active' })
    f.deps.models.image = async () => {
      throw new Error('no image model in tests')
    }
    const ads = await renderAds(t.db, f.deps.models, t.shop, {
      productId: draft.productId,
      occasion: 'eid',
      offerText: '10% off',
      formats: ['square', 'story'],
    })
    expect(ads.map((a) => [a.width, a.height])).toEqual([
      [1080, 1080],
      [1080, 1080],
      [1080, 1920],
    ])
  }, 60_000)
})
