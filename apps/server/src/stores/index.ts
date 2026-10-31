import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { stores } from '../db/schema.ts'
import { env } from '../env.ts'
import { mask, unseal } from './crypto.ts'
import { StoreError, type StoreConnector } from './types.ts'

export type StoreRow = typeof stores.$inferSelect
export type Credentials = Record<string, string>
export type Store = { row: StoreRow | null; connector: StoreConnector | null }

export function connectorFor(row: StoreRow): StoreConnector | null {
  if (row.kind === 'builtin') return null
  throw new StoreError(`${row.kind} stores are not supported yet`)
}

// The builtin kind has no connector: the local tables are the store.
export async function storeFor(db: Db, shopId: string): Promise<Store> {
  const [row] = await db.select().from(stores).where(eq(stores.shopId, shopId))
  if (!row) return { row: null, connector: null }
  return { row, connector: connectorFor(row) }
}

export function maskedCredentials(row: StoreRow) {
  if (!row.credentials) return {}
  const creds = unseal<Credentials>(row.credentials, env.STORE_SECRET_KEY)
  return Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, mask(v)]))
}
