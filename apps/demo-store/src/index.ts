import { serve } from '@hono/node-server'
import { createStoreApp } from './app.ts'
import { openDb } from './db.ts'

const env = process.env
const token = env.DEMO_STORE_TOKEN
if (!token || token.length < 8) throw new Error('DEMO_STORE_TOKEN must be set (8+ characters)')

const db = await openDb(env.DEMO_STORE_DATABASE_URL ?? 'file:./data/demo-store.db')
const saudaai =
  env.DEMO_STORE_SAUDAAI_URL && env.DEMO_STORE_SHOP_ID && env.DEMO_STORE_WEBHOOK_SECRET
    ? {
        url: env.DEMO_STORE_SAUDAAI_URL.replace(/\/$/, ''),
        shopId: env.DEMO_STORE_SHOP_ID,
        webhookSecret: env.DEMO_STORE_WEBHOOK_SECRET,
        publicKey: env.DEMO_STORE_PUBLIC_KEY,
      }
    : undefined

const port = Number(env.DEMO_STORE_PORT ?? env.PORT ?? 8790)
serve({ fetch: createStoreApp(db, { token, saudaai }).fetch, port })
console.log(
  `demo store on http://localhost:${port}${saudaai ? '' : ' (not linked to saudaai yet)'}`,
)
