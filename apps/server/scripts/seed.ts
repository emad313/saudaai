import { eq } from 'drizzle-orm'
import { migrateDb, openDb } from '../src/db/client.ts'
import { shops } from '../src/db/schema.ts'
import { seedDemoShop } from '../src/db/seed.ts'
import { env } from '../src/env.ts'
import { log } from '../src/log.ts'

const db = openDb(env.DATABASE_URL)
await migrateDb(db)
const [existing] = await db.select().from(shops).where(eq(shops.slug, env.DEMO_SHOP_SLUG))
if (existing) {
  log.info({ slug: existing.slug, linkCode: existing.linkCode }, 'demo shop already seeded')
} else {
  const shop = await seedDemoShop(db, Date.now(), env.DEMO_SHOP_SLUG)
  log.info({ slug: shop.slug, linkCode: shop.linkCode }, 'demo shop seeded')
}
