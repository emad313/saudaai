import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../db/ids.ts'
import { stores } from '../db/schema.ts'
import { testShop } from '../test/shop.ts'
import { seal, unseal } from './crypto.ts'
import { storeFor } from './index.ts'

const key = Buffer.alloc(32, 7).toString('base64')

let t: Awaited<ReturnType<typeof testShop>>
beforeEach(async () => {
  t = await testShop()
})

describe('credentials', () => {
  it('round-trips and never stores the plain value', () => {
    const sealed = seal({ token: 'shpat_secret_123' }, key)
    expect(sealed).not.toContain('shpat')
    expect(unseal(sealed, key)).toEqual({ token: 'shpat_secret_123' })
  })

  it('rejects a tampered value and a wrong key', () => {
    const sealed = seal({ token: 'x' }, key)
    const flipped = `${sealed.slice(0, -4)}${sealed.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`
    expect(() => unseal(flipped, key)).toThrow()
    expect(() => unseal(sealed, Buffer.alloc(32, 8).toString('base64'))).toThrow()
  })

  it('refuses to work without a 32 byte key', () => {
    expect(() => seal({}, undefined)).toThrow('STORE_SECRET_KEY is not set')
    expect(() => seal({}, 'c2hvcnQ=')).toThrow('32 bytes')
  })
})

describe('storeFor', () => {
  it('treats a shop with no store row as builtin', async () => {
    expect(await storeFor(t.db, t.shop.id)).toEqual({ row: null, connector: null })
  })

  it('has no connector for an explicit builtin store', async () => {
    await t.db.insert(stores).values({
      id: newId(),
      shopId: t.shop.id,
      kind: 'builtin',
      name: t.shop.name,
      status: 'connected',
      createdAt: t.ctx().now,
    })
    const store = await storeFor(t.db, t.shop.id)
    expect(store.row?.kind).toBe('builtin')
    expect(store.connector).toBeNull()
  })
})
