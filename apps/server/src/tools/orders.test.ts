import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { variants } from '../db/schema.ts'
import { testShop } from '../test/shop.ts'
import { createCustomer } from './customers.ts'
import { createOrder, getOrder, recordPayment, updateOrderStatus } from './orders.ts'
import { findProducts } from './products.ts'

let t: Awaited<ReturnType<typeof testShop>>

async function variant(query: string, size: string) {
  const { matches } = await findProducts(t.ctx(), { query })
  const v = matches[0]!.variants.find((x) => x.size === size)!
  return v.variantId
}

async function stockOf(variantId: string) {
  const [v] = await t.db.select().from(variants).where(eq(variants.id, variantId))
  return { stock: v!.stock, reserved: v!.reserved }
}

beforeEach(async () => {
  t = await testShop()
})

describe('createOrder', () => {
  it('computes totals in code and reserves stock', async () => {
    const vid = await variant('kalo tshirt', 'L')
    const before = await stockOf(vid)
    const c = await createCustomer(t.ctx(), {
      name: 'Test',
      phone: '01700111222',
      area: 'Mirpur 10',
    })
    const order = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: vid, qty: 2 }],
      deliveryArea: 'Mirpur 10',
      paymentMethod: 'bkash',
      source: 'seller_voice',
    })
    expect(order.totalPoisha).toBe(2 * 45000 + 6000)
    expect(order.total).toBe('৳960')
    expect(order.status).toBe('draft')
    expect(await stockOf(vid)).toEqual({ stock: before.stock, reserved: before.reserved + 2 })
  })

  it('charges outside-Dhaka delivery', async () => {
    const vid = await variant('maroon kurti', 'M')
    const c = await createCustomer(t.ctx(), { name: 'Ctg', area: 'Chattogram' })
    const order = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: vid, qty: 1 }],
      deliveryArea: 'Chattogram',
      paymentMethod: 'cod',
      source: 'seller_text',
    })
    expect(order.totalPoisha).toBe(125000 + 12000)
  })

  it('rejects more than available and leaves nothing reserved', async () => {
    const ok = await variant('kalo tshirt', 'M')
    const short = await variant('navy kurti', 'XL')
    const before = await stockOf(ok)
    const c = await createCustomer(t.ctx(), { name: 'Greedy' })
    await expect(
      createOrder(t.ctx(), {
        customerId: c.customerId,
        lines: [
          { variantId: ok, qty: 1 },
          { variantId: short, qty: 50 },
        ],
        deliveryArea: 'Dhaka',
        paymentMethod: 'cod',
        source: 'seller_text',
      }),
    ).rejects.toMatchObject({ code: 'out_of_stock' })
    expect(await stockOf(ok)).toEqual(before)
  })

  it('rejects payment methods the shop does not take', async () => {
    const vid = await variant('kalo tshirt', 'M')
    const c = await createCustomer(t.ctx(), { name: 'X' })
    await expect(
      createOrder(t.ctx(), {
        customerId: c.customerId,
        lines: [{ variantId: vid, qty: 1 }],
        deliveryArea: 'Dhaka',
        paymentMethod: 'rocket',
        source: 'seller_text',
      }),
    ).rejects.toMatchObject({ code: 'bad_payment_method' })
  })
})

describe('order lifecycle', () => {
  async function draft(qty = 1) {
    const vid = await variant('white tshirt', 'M')
    const c = await createCustomer(t.ctx(), { name: 'Life', area: 'Dhanmondi' })
    const order = await createOrder(t.ctx(), {
      customerId: c.customerId,
      lines: [{ variantId: vid, qty }],
      deliveryArea: 'Dhanmondi',
      paymentMethod: 'bkash',
      source: 'seller_text',
    })
    return { vid, order }
  }

  it('releases reservation on cancel', async () => {
    const { vid, order } = await draft(2)
    const reserved = (await stockOf(vid)).reserved
    await updateOrderStatus(t.ctx(), { orderId: order.orderId, status: 'cancelled' })
    expect((await stockOf(vid)).reserved).toBe(reserved - 2)
  })

  it('turns reservation into a sale on ship', async () => {
    const { vid, order } = await draft(2)
    const before = await stockOf(vid)
    await updateOrderStatus(t.ctx(), { orderId: order.orderId, status: 'confirmed' })
    await updateOrderStatus(t.ctx(), { orderId: order.orderId, status: 'shipped' })
    expect(await stockOf(vid)).toEqual({ stock: before.stock - 2, reserved: before.reserved - 2 })
  })

  it('refuses impossible transitions', async () => {
    const { order } = await draft()
    await expect(
      updateOrderStatus(t.ctx(), { orderId: order.orderId, status: 'delivered' }),
    ).rejects.toMatchObject({ code: 'bad_transition' })
  })

  it('tracks partial and full payment, refuses overpayment', async () => {
    const { order } = await draft()
    const half = await recordPayment(t.ctx(), {
      orderId: order.orderId,
      amountPoisha: 20000,
      method: 'bkash',
    })
    expect(half.paymentStatus).toBe('partial')
    await expect(
      recordPayment(t.ctx(), {
        orderId: order.orderId,
        amountPoisha: half.duePoisha + 1,
        method: 'bkash',
      }),
    ).rejects.toMatchObject({ code: 'overpaid' })
    const full = await recordPayment(t.ctx(), {
      orderId: order.orderId,
      amountPoisha: half.duePoisha,
      method: 'bkash',
    })
    expect(full.paymentStatus).toBe('paid')
    expect(full.duePoisha).toBe(0)
  })

  it('hides other customers orders from a customer', async () => {
    const { order } = await draft()
    await expect(
      getOrder(t.ctx({ actor: 'customer', customerId: 'someone-else' }), {
        orderId: order.orderId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
