import { beforeAll, describe, expect, it } from 'vitest'
import { testShop } from '../test/shop.ts'
import { createCustomer, findCustomers } from './customers.ts'
import { adjustStock, createProductDraft, findProducts, getProduct } from './products.ts'
import { dailySummary } from './reports.ts'

let t: Awaited<ReturnType<typeof testShop>>

beforeAll(async () => {
  t = await testShop()
})

describe('findProducts', () => {
  it.each([
    ['kalo tshirt', 'Black Cotton T-Shirt'],
    ['কালো টি-শার্ট', 'Black Cotton T-Shirt'],
    ['maroon kurti', 'Maroon Block Print Kurti'],
    ['three piece', 'Peach Georgette Three-Piece'],
    ['হিজাব', 'Jersey Hijab'],
  ])('%s -> %s', async (query, name) => {
    const { matches } = await findProducts(t.ctx(), { query })
    expect(matches[0]?.name).toBe(name)
  })

  it('returns nothing for unrelated words', async () => {
    const { matches } = await findProducts(t.ctx(), { query: 'laptop charger' })
    expect(matches).toEqual([])
  })

  it('hides drafts from customers', async () => {
    await createProductDraft(t.ctx(), {
      name: 'Secret Saree',
      category: 'saree',
      pricePoisha: 300000,
      variants: [{ stock: 2 }],
    })
    expect((await findProducts(t.ctx(), { query: 'saree' })).matches).toHaveLength(1)
    expect((await findProducts(t.ctx({ actor: 'customer' }), { query: 'saree' })).matches).toEqual(
      [],
    )
  })
})

describe('adjustStock', () => {
  it('adds stock and refuses to go below reserved', async () => {
    const { matches } = await findProducts(t.ctx(), { query: 'tote bag' })
    const v = matches[0]!.variants[0]!
    const up = await adjustStock(t.ctx(), { variantId: v.variantId, delta: 5, reason: 'new lot' })
    expect(up.available).toBe(v.available + 5)
    await expect(
      adjustStock(t.ctx(), { variantId: v.variantId, delta: -1000, reason: 'oops' }),
    ).rejects.toMatchObject({ code: 'stock_negative' })
    const p = await getProduct(t.ctx(), { productId: matches[0]!.productId })
    expect(p.variants[0]!.available).toBe(v.available + 5)
  })
})

describe('customers', () => {
  it('matches phone numbers in any common format', async () => {
    const { matches } = await findCustomers(t.ctx(), { query: '+880 1711-000101' })
    expect(matches[0]?.name).toBe('Rahim Uddin')
  })

  it('reuses the customer when the phone already exists', async () => {
    const c = await createCustomer(t.ctx(), { name: 'Rahim bhai', phone: '01711000101' })
    expect(c.existing).toBe(true)
    expect(c.name).toBe('Rahim Uddin')
  })

  it('rejects invalid phone numbers', async () => {
    await expect(createCustomer(t.ctx(), { name: 'X', phone: '12345' })).rejects.toMatchObject({
      code: 'bad_phone',
    })
  })
})

describe('dailySummary', () => {
  it('summarises seeded history', async () => {
    const s = await dailySummary(t.ctx())
    expect(s.dues.orders).toBeGreaterThan(0)
    expect(s.draftOrders).toBe(1)
  })
})
