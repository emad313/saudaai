import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDb, openDb } from '../db/client.ts'
import { seedDemoShop } from '../db/seed.ts'
import type { Ctx } from '../tools/ctx.ts'

export const now = Date.parse('2026-10-28T12:00:00+06:00')

export async function testShop() {
  const db = openDb(`file:${join(mkdtempSync(join(tmpdir(), 'saudaai-')), 'test.db')}`)
  await migrateDb(db)
  const shop = await seedDemoShop(db, now)
  const ctx = (over: Partial<Ctx> = {}): Ctx => ({ db, shop, actor: 'seller', now, ...over })
  return { db, shop, ctx }
}
