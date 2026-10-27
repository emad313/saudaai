import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { migrateDb, openDb, type Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { conversations, messages } from '../db/schema.ts'
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

export async function chat(
  db: Db,
  shopId: string,
  text: string,
  over: Partial<typeof conversations.$inferInsert> = {},
) {
  const id = over.id ?? newId()
  await db
    .insert(conversations)
    .values({
      id,
      shopId,
      channel: 'webchat',
      externalUserId: `web_${id}`,
      lastInboundAt: now,
      createdAt: now,
      ...over,
    })
    .onConflictDoNothing()
  await db.insert(messages).values({
    id: newId(),
    conversationId: id,
    role: over.channel === 'telegram_seller' ? 'seller' : 'customer',
    kind: 'text',
    text,
    createdAt: now + Math.floor(Math.random() * 1000),
  })
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id))
  return c!
}
