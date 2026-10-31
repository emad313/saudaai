import { randomBytes } from 'node:crypto'
import { eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { products, stores, type StoreKind } from '../db/schema.ts'
import { env } from '../env.ts'
import { mask, seal, unseal } from './crypto.ts'
import { customConnector } from './custom.ts'
import { shopifyConnector } from './shopify.ts'
import { wooConnector } from './woocommerce.ts'
import { StoreError, type StoreConnector } from './types.ts'

export type StoreRow = typeof stores.$inferSelect
export type Credentials = Record<string, string>
export type Store = { row: StoreRow | null; connector: StoreConnector | null }

export function connectorFor(row: StoreRow): StoreConnector | null {
  if (row.kind === 'builtin') return null
  const creds = row.credentials ? unseal<Credentials>(row.credentials, env.STORE_SECRET_KEY) : {}
  const secret = row.webhookSecret ? unseal<string>(row.webhookSecret, env.STORE_SECRET_KEY) : ''
  switch (row.kind) {
    case 'custom':
      return customConnector(row, creds, secret)
    case 'shopify':
      return shopifyConnector(row, creds, secret)
    case 'woocommerce':
      return wooConnector(row, creds, secret)
  }
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

export type ConnectInput = {
  kind: StoreKind
  baseUrl?: string
  credentials: Credentials
  webhookSecret?: string
}

// Tests the connection with the new credentials before anything is saved.
export async function connectStore(
  db: Db,
  shop: { id: string; name: string },
  input: ConnectInput,
  now: number,
) {
  const [existing] = await db.select().from(stores).where(eq(stores.shopId, shop.id))
  const webhookSecret =
    input.kind === 'builtin' ? null : (input.webhookSecret ?? randomBytes(24).toString('hex'))
  const row: StoreRow = {
    id: existing?.id ?? newId(),
    shopId: shop.id,
    kind: input.kind,
    name: shop.name,
    baseUrl: input.baseUrl?.replace(/\/$/, '') ?? null,
    credentials: input.kind === 'builtin' ? null : seal(input.credentials, env.STORE_SECRET_KEY),
    webhookSecret: webhookSecret ? seal(webhookSecret, env.STORE_SECRET_KEY) : null,
    currency: 'BDT',
    status: 'connected',
    lastSyncAt: existing?.kind === input.kind ? (existing.lastSyncAt ?? null) : null,
    lastError: null,
    createdAt: existing?.createdAt ?? now,
  }
  const connector = connectorFor(row)
  if (connector) {
    const res = await connector.test()
    if (!res.ok) throw new StoreError(res.error, 400)
    row.name = res.name
    row.currency = res.currency
  }
  await db
    .insert(stores)
    .values(row)
    .onConflictDoUpdate({ target: stores.shopId, set: { ...row, id: undefined } })
  return { row, connector, webhookSecret }
}

export function webhookSecretOf(row: StoreRow) {
  return row.webhookSecret ? unseal<string>(row.webhookSecret, env.STORE_SECRET_KEY) : null
}

// With an external store connected only its synced products are the catalog; builtin products stay local.
export async function catalogScope(db: Db, shopId: string) {
  const [row] = await db.select().from(stores).where(eq(stores.shopId, shopId))
  return row && row.kind !== 'builtin' ? eq(products.storeId, row.id) : isNull(products.storeId)
}
