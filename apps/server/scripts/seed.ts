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
// On a host where the logs are hard to reach, the owner picks the Telegram link code instead.
if (env.SHOP_LINK_CODE && !shop.telegramChatId && shop.linkCode !== env.SHOP_LINK_CODE) {
  await db.update(shops).set({ linkCode: env.SHOP_LINK_CODE }).where(eq(shops.id, shop.id))
  shop.linkCode = env.SHOP_LINK_CODE
}
log.info(
  { slug: shop.slug, linkCode: shop.linkCode },
  existing ? 'shop already exists' : 'shop created',
)
