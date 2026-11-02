import { eq } from 'drizzle-orm'
import { migrateDb, openDb } from '../src/db/client.ts'
import { shops } from '../src/db/schema.ts'
import { createShop } from '../src/db/shop.ts'
import { env } from '../src/env.ts'
import { log } from '../src/log.ts'

// Only the shop account: connect a store in Settings (or `pnpm demo:link`) to bring in products and orders.
const db = openDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN)
await migrateDb(db)
const [existing] = await db.select().from(shops).where(eq(shops.slug, env.DEMO_SHOP_SLUG))
const shop = existing ?? (await createShop(db, { slug: env.DEMO_SHOP_SLUG }))
log.info(
  { slug: shop.slug, linkCode: shop.linkCode },
  existing ? 'shop already exists' : 'shop created',
)
