import { migrateDb, openDb } from '../src/db/client.ts'
import { env } from '../src/env.ts'
import { log } from '../src/log.ts'

await migrateDb(openDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN))
log.info({ url: env.DATABASE_URL }, 'migrated')
