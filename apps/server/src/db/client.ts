import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.ts'

export type Db = ReturnType<typeof openDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Conn = Db | Tx

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function openDb(url: string) {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true })
  const client = createClient({ url })
  return drizzle(client, { schema })
}

let writes: Promise<unknown> = Promise.resolve()

// SQLite has one writer; libsql opens a fresh connection per transaction, so concurrent
// transactions fail with SQLITE_BUSY instead of waiting. Queue them in-process instead.
export function write<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = writes.then(() => db.transaction(fn))
  writes = run.catch(() => undefined)
  return run
}

export async function migrateDb(db: Db) {
  await db.run('pragma foreign_keys = on')
  await migrate(db, { migrationsFolder })
}
