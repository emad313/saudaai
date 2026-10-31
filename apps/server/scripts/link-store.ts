import { eq } from 'drizzle-orm'
import { openDb } from '../src/db/client.ts'
import { shops } from '../src/db/schema.ts'
import { env } from '../src/env.ts'
import { connectStore } from '../src/stores/index.ts'
import { pullStore } from '../src/stores/sync.ts'

// Connects the demo shop to apps/demo-store through the SaudaAI Store API, like a seller would.
const url = process.env.DEMO_STORE_URL ?? 'http://localhost:8790'
const token = process.env.DEMO_STORE_TOKEN
if (!token) throw new Error('set DEMO_STORE_TOKEN in .env (the same value the demo store uses)')

const db = openDb(env.DATABASE_URL)
const [shop] = await db.select().from(shops).where(eq(shops.slug, env.DEMO_SHOP_SLUG))
if (!shop) throw new Error(`no shop ${env.DEMO_SHOP_SLUG}, run pnpm db:seed first`)

const { row, connector, webhookSecret } = await connectStore(
  db,
  shop,
  { kind: 'custom', baseUrl: url, credentials: { token } },
  Date.now(),
)
const synced = await pullStore(db, row, connector!, Date.now())
console.log(`linked ${shop.name} to ${url}, ${synced.products} products synced`)
console.log('\nadd these to .env and restart the demo store:\n')
console.log(`DEMO_STORE_SAUDAAI_URL=${env.PUBLIC_BASE_URL}`)
console.log(`DEMO_STORE_SHOP_ID=${shop.id}`)
console.log(`DEMO_STORE_WEBHOOK_SECRET=${webhookSecret}`)
console.log(`DEMO_STORE_PUBLIC_KEY=${shop.publicKey}`)
process.exit(0)
