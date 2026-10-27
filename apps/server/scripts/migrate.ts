import { migrateDb, openDb } from '../src/db/client.ts'
import { env } from '../src/env.ts'
import { log } from '../src/log.ts'

await migrateDb(openDb(env.DATABASE_URL))
log.info({ url: env.DATABASE_URL }, 'migrated')
