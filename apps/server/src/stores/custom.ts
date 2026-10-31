import { z } from 'zod'
import type { Credentials, StoreRow } from './index.ts'
import { failure, hmacMatches, queued, storeRequest } from './http.ts'
import { externalProduct, storeEvents, storeOrder } from './schema.ts'
import { StoreError, type StoreConnector } from './types.ts'

const info = z.object({ name: z.string(), currency: z.string() })
const page = z.object({ products: z.array(externalProduct), next: z.string().optional() })
const orderPage = z.object({ orders: z.array(storeOrder), next: z.string().optional() })
const created = z.object({
  externalId: z.string(),
  number: z.coerce.string(),
  totalPoisha: z.number().int(),
  adminUrl: z.string().optional(),
})

// Any site that implements the SaudaAI Store API (see README) with a bearer token.
export function customConnector(row: StoreRow, creds: Credentials, secret: string): StoreConnector {
  const base = `${(row.baseUrl ?? '').replace(/\/$/, '')}/saudaai`
  const call = (method: string, path: string, body?: unknown) =>
    queued(row.id, () =>
      storeRequest(`${base}${path}`, {
        method,
        body,
        headers: { authorization: `Bearer ${creds.token}` },
      }),
    )
  const json = async <T>(res: Response, schema: z.ZodType<T>) => {
    if (!res.ok) throw await failure(res)
    return schema.parse(await res.json())
  }

  return {
    kind: 'custom',
    async test() {
      try {
        const shop = await json(await call('GET', '/info'), info)
        if (shop.currency !== 'BDT')
          return { ok: false, error: `currency ${shop.currency} is not supported yet, only BDT` }
        return { ok: true, ...shop }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    async listProducts(cursor) {
      return json(
        await call('GET', `/products${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
        page,
      )
    },
    async getProduct(externalId) {
      const res = await call('GET', `/products/${encodeURIComponent(externalId)}`)
      if (res.status === 404) return null
      return json(res, externalProduct)
    },
    async createOrder(input) {
      return json(await call('POST', '/orders', input), created)
    },
    async updateOrder(externalId, change) {
      const res = await call('PATCH', `/orders/${encodeURIComponent(externalId)}`, change)
      if (!res.ok) throw await failure(res)
    },
    // Optional routes: a site that does not offer them answers 404 and the owner is told to use the store admin.
    async createProduct(p) {
      const res = await call('POST', '/products', {
        ...p,
        variants: p.variants.map(({ externalId: _, ...v }) => v),
      })
      if (res.status === 404 || res.status === 405)
        throw new StoreError('the site does not take new products from SaudaAI', 404)
      return json(res, externalProduct)
    },
    async publishProduct(externalId) {
      const res = await call('PATCH', `/products/${encodeURIComponent(externalId)}`, {
        status: 'active',
      })
      if (!res.ok) throw await failure(res)
    },
    async adjustStock(variantExternalId, delta) {
      const res = await call('POST', '/stock', { variantExternalId, delta })
      if (res.status === 404 || res.status === 405)
        throw new StoreError('the site does not take stock changes from SaudaAI', 404)
      return (await json(res, z.object({ stock: z.number().int() }))).stock
    },
    async getOrder(externalId) {
      const res = await call('GET', `/orders/${encodeURIComponent(externalId)}`)
      if (res.status === 404) return null
      return json(res, storeOrder)
    },
    async listOrders(since, cursor) {
      const q = new URLSearchParams({ since: String(since), ...(cursor ? { cursor } : {}) })
      return json(await call('GET', `/orders?${q}`), orderPage)
    },
    async parseWebhook({ headers, raw }) {
      const sig = headers['x-saudaai-signature'] ?? ''
      if (!secret || !sig.startsWith('sha256=') || !hmacMatches(raw, secret, sig.slice(7), 'hex')) {
        throw new StoreError('bad webhook signature', 401)
      }
      return storeEvents.parse(JSON.parse(raw))
    },
  }
}
