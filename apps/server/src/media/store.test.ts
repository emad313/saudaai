import { rm } from 'node:fs/promises'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { env } from '../env.ts'
import { testShop } from '../test/shop.ts'
import { loadMedia, saveMedia } from './store.ts'

const url = env.DATABASE_URL
afterEach(() => {
  env.DATABASE_URL = url
})

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#1a8cf0' } })
    .png()
    .toBuffer()

describe('media', () => {
  it('brings a file back from the database after the disk was wiped', async () => {
    env.DATABASE_URL = 'libsql://shop.turso.io'
    const { db } = await testShop()
    const bytes = await png()
    const saved = await saveMedia(db, bytes, 'image/png')
    await rm(saved.path)
    expect((await loadMedia(db, saved.id))!.bytes.equals(bytes)).toBe(true)
  })

  it('treats a missing file as missing when the disk is the store', async () => {
    const { db } = await testShop()
    const saved = await saveMedia(db, Buffer.concat([await png(), Buffer.from('x')]), 'image/png')
    await rm(saved.path)
    expect(await loadMedia(db, saved.id)).toBeNull()
  })
})
