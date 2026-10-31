import { parseTaka } from '@saudaai/shared'
import type { Credentials, StoreRow } from './index.ts'
import { decimal, failure, hmacMatches, queued, storeRequest } from './http.ts'
import {
  StoreError,
  type ExternalProduct,
  type ExternalVariant,
  type StoreConnector,
  type StoreEvent,
  type StoreOrder,
} from './types.ts'

type WooAttribute = { name: string; option?: string; options?: string[] }
type WooImage = { src: string }
type WooProduct = {
  id: number
  name: string
  type: 'simple' | 'variable' | string
  status: string
  sku: string
  price: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: string
  categories: { name: string }[]
  images: WooImage[]
}
type WooVariation = {
  id: number
  sku: string
  price: string
  manage_stock: boolean | 'parent'
  stock_quantity: number | null
  stock_status: string
  attributes: WooAttribute[]
}
type WooOrder = {
  id: number
  number: string
  total: string
  status: string
  date_paid: string | null
  date_created_gmt?: string
  shipping_total?: string
  payment_method?: string
  billing?: {
    first_name: string
    last_name: string
    phone: string
    email: string
    address_1: string
    city: string
  }
  line_items?: {
    product_id: number
    variation_id: number
    quantity: number
    price: number | string
  }[]
}

// Abandoned or unpaid online checkouts are not real orders yet.
const notPlaced = new Set(['pending', 'failed', 'checkout-draft', 'trash'])

const poisha = (value: string) => parseTaka(value || '0') ?? 0

const statusOf = (s: string): ExternalProduct['status'] =>
  s === 'publish' ? 'active' : s === 'trash' ? 'archived' : 'draft'

// Untracked stock is null; a product marked out of stock without a count is 0.
const stockOf = (manage: boolean | 'parent', qty: number | null, status: string) =>
  manage ? Math.max(0, qty ?? 0) : status === 'outofstock' ? 0 : null

function attribute(attrs: WooAttribute[], pattern: RegExp) {
  return attrs.find((a) => pattern.test(a.name))?.option
}

// A variant id carries the parent too, because Woo order lines need both product and variation ids.
const variantId = (productId: number, variationId?: number) =>
  variationId ? `${productId}:${variationId}` : String(productId)

function toProduct(p: WooProduct, variations: WooVariation[]): ExternalProduct {
  const variants: ExternalVariant[] =
    p.type === 'variable'
      ? variations.map((v) => ({
          externalId: variantId(p.id, v.id),
          size: attribute(v.attributes, /size|সাইজ/i),
          color: attribute(v.attributes, /colou?r|রং/i),
          sku: v.sku || undefined,
          pricePoisha: poisha(v.price),
          stock:
            v.manage_stock === 'parent'
              ? stockOf(p.manage_stock, p.stock_quantity, p.stock_status)
              : stockOf(v.manage_stock, v.stock_quantity, v.stock_status),
        }))
      : [
          {
            externalId: variantId(p.id),
            sku: p.sku || undefined,
            pricePoisha: poisha(p.price),
            stock: stockOf(p.manage_stock, p.stock_quantity, p.stock_status),
          },
        ]
  return {
    externalId: String(p.id),
    name: p.name,
    category: p.categories[0]?.name,
    imageUrl: p.images[0]?.src,
    status: statusOf(p.status),
    variants,
  }
}

const orderStatus = (s: string) =>
  ({
    'on-hold': 'confirmed',
    pending: 'confirmed',
    processing: 'confirmed',
    completed: 'delivered',
    cancelled: 'cancelled',
    refunded: 'cancelled',
    failed: 'cancelled',
  })[s] ?? 'confirmed'

function fromWooOrder(o: WooOrder, site: string): StoreOrder | null {
  if (notPlaced.has(o.status)) return null
  const b = o.billing
  const total = poisha(o.total)
  return {
    externalId: String(o.id),
    number: o.number,
    status: orderStatus(o.status) as StoreOrder['status'],
    createdAt: o.date_created_gmt ? Date.parse(`${o.date_created_gmt}Z`) : Date.now(),
    customer: {
      name: [b?.first_name, b?.last_name].filter(Boolean).join(' ') || 'Customer',
      phone: b?.phone || undefined,
      email: b?.email || undefined,
      address: b?.address_1 || undefined,
      area: b?.city || undefined,
    },
    lines: (o.line_items ?? []).map((l) => ({
      variantExternalId: variantId(l.product_id, l.variation_id || undefined),
      productExternalId: String(l.product_id),
      qty: l.quantity,
      unitPricePoisha: poisha(String(l.price)),
    })),
    shippingPoisha: poisha(o.shipping_total ?? '0'),
    totalPoisha: total,
    paidPoisha: o.date_paid ? total : 0,
    paymentMethod: o.payment_method || undefined,
    adminUrl: `${site}/wp-admin/admin.php?page=wc-orders&action=edit&id=${o.id}`,
  }
}

export function wooConnector(row: StoreRow, creds: Credentials, secret: string): StoreConnector {
  const site = (row.baseUrl ?? '').replace(/\/$/, '')
  const base = `${site}/wp-json/wc/v3`
  const auth = `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')}`

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; res: Response }> {
    const res = await queued(row.id, () =>
      storeRequest(`${base}${path}`, { method, body, headers: { authorization: auth } }),
    )
    if (!res.ok) throw await failure(res)
    return { data: (await res.json()) as T, res }
  }

  async function full(p: WooProduct) {
    if (p.type !== 'variable') return toProduct(p, [])
    const { data } = await call<WooVariation[]>('GET', `/products/${p.id}/variations?per_page=100`)
    return toProduct(p, data)
  }

  async function getProduct(externalId: string) {
    const res = await queued(row.id, () =>
      storeRequest(`${base}/products/${encodeURIComponent(externalId)}`, {
        headers: { authorization: auth },
      }),
    )
    if (res.status === 404) return null
    if (!res.ok) throw await failure(res)
    return full((await res.json()) as WooProduct)
  }

  async function note(orderId: string, text: string) {
    await call('POST', `/orders/${orderId}/notes`, { note: text })
  }

  return {
    kind: 'woocommerce',

    async test() {
      try {
        const { data: currency } = await call<{ value: string }>(
          'GET',
          '/settings/general/woocommerce_currency',
        )
        if (currency.value !== 'BDT') {
          return {
            ok: false,
            error: `store currency is ${currency.value}; only BDT is supported yet`,
          }
        }
        const site = await queued(row.id, () =>
          storeRequest(`${(row.baseUrl ?? '').replace(/\/$/, '')}/wp-json/`, {}),
        )
        const name = site.ok ? ((await site.json()) as { name?: string }).name : undefined
        return { ok: true, name: name || new URL(row.baseUrl ?? base).host, currency: 'BDT' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async listProducts(cursor) {
      const page = Number(cursor ?? 1)
      const { data, res } = await call<WooProduct[]>('GET', `/products?per_page=50&page=${page}`)
      const pages = Number(res.headers.get('x-wp-totalpages') ?? 1)
      const products = []
      for (const p of data) products.push(await full(p))
      return { products, next: page < pages ? String(page + 1) : undefined }
    },

    getProduct,

    async createOrder(input) {
      const [first, ...rest] = input.customer.name.trim().split(/\s+/)
      const address = {
        first_name: first,
        last_name: rest.join(' '),
        address_1: input.customer.address ?? input.customer.area ?? '',
        city: input.customer.area ?? '',
        country: 'BD',
        phone: input.customer.phone ?? '',
      }
      const { data } = await call<WooOrder>('POST', '/orders', {
        status: 'on-hold',
        set_paid: false,
        payment_method: input.paymentMethod,
        payment_method_title:
          { cod: 'Cash on delivery', bkash: 'bKash', nagad: 'Nagad' }[input.paymentMethod] ??
          input.paymentMethod,
        billing: { ...address, ...(input.customer.email ? { email: input.customer.email } : {}) },
        shipping: address,
        line_items: input.lines.map((l) => {
          const [product, variation] = l.variantExternalId.split(':')
          return {
            product_id: Number(product),
            ...(variation ? { variation_id: Number(variation) } : {}),
            quantity: l.qty,
          }
        }),
        shipping_lines: [
          {
            method_id: 'flat_rate',
            method_title: 'Delivery',
            total: decimal(input.shippingPoisha),
          },
        ],
        customer_note: input.note ?? '',
        meta_data: [{ key: '_saudaai_tags', value: input.tags.join(',') }],
      })
      return {
        externalId: String(data.id),
        number: data.number,
        totalPoisha: poisha(data.total),
        adminUrl: `${(row.baseUrl ?? '').replace(/\/$/, '')}/wp-admin/admin.php?page=wc-orders&action=edit&id=${data.id}`,
      }
    },

    async updateOrder(externalId, change) {
      if (change.status === 'cancelled' || change.status === 'delivered') {
        const status = change.status === 'delivered' ? 'completed' : 'cancelled'
        await call('PUT', `/orders/${externalId}`, { status })
      }
      if (change.status === 'shipped') await note(externalId, 'Shipped (SaudaAI)')
      if (change.paidPoisha !== undefined) {
        const { data } = await call<WooOrder>('GET', `/orders/${externalId}`)
        if (change.paidPoisha >= poisha(data.total)) {
          await call('PUT', `/orders/${externalId}`, {
            set_paid: true,
            ...(data.status === 'on-hold' ? { status: 'processing' } : {}),
          })
        }
      }
      if (change.note) await note(externalId, change.note)
    },

    async getOrder(externalId) {
      const res = await queued(row.id, () =>
        storeRequest(`${base}/orders/${encodeURIComponent(externalId)}`, {
          headers: { authorization: auth },
        }),
      )
      if (res.status === 404) return null
      if (!res.ok) throw await failure(res)
      return fromWooOrder((await res.json()) as WooOrder, site)
    },

    async listOrders(since, cursor) {
      const page = Number(cursor ?? 1)
      const after = encodeURIComponent(new Date(since).toISOString())
      const { data, res } = await call<WooOrder[]>(
        'GET',
        `/orders?per_page=50&page=${page}&after=${after}`,
      )
      const pages = Number(res.headers.get('x-wp-totalpages') ?? 1)
      return {
        orders: data.map((o) => fromWooOrder(o, site)).filter((o): o is StoreOrder => o !== null),
        next: page < pages ? String(page + 1) : undefined,
      }
    },

    async adjustStock(variantExternalId, delta) {
      const [product, variation] = variantExternalId.split(':')
      const path = variation
        ? `/products/${product}/variations/${variation}`
        : `/products/${product}`
      const { data } = await call<{
        manage_stock: boolean | 'parent'
        stock_quantity: number | null
      }>('GET', path)
      if (data.manage_stock !== true)
        throw new StoreError('woocommerce: stock is not tracked for this item')
      const stock = Math.max(0, (data.stock_quantity ?? 0) + delta)
      await call('PUT', path, { stock_quantity: stock })
      return stock
    },

    async createProduct(p) {
      const sizes = [...new Set(p.variants.map((v) => v.size).filter(Boolean))] as string[]
      const colors = [...new Set(p.variants.map((v) => v.color).filter(Boolean))] as string[]
      const variable = sizes.length + colors.length > 0
      const attributes = [
        ...(sizes.length ? [{ name: 'Size', variation: true, visible: true, options: sizes }] : []),
        ...(colors.length
          ? [{ name: 'Color', variation: true, visible: true, options: colors }]
          : []),
      ]
      const simple = p.variants[0]
      const { data: made } = await call<WooProduct>('POST', '/products', {
        name: p.name,
        type: variable ? 'variable' : 'simple',
        status: 'draft',
        images: p.imageUrl ? [{ src: p.imageUrl }] : [],
        ...(variable
          ? { attributes }
          : {
              regular_price: decimal(simple?.pricePoisha ?? 0),
              manage_stock: true,
              stock_quantity: simple?.stock ?? 0,
            }),
      })
      if (variable) {
        await call('POST', `/products/${made.id}/variations/batch`, {
          create: p.variants.map((v) => ({
            regular_price: decimal(v.pricePoisha),
            manage_stock: true,
            stock_quantity: v.stock ?? 0,
            attributes: [
              ...(v.size ? [{ name: 'Size', option: v.size }] : []),
              ...(v.color ? [{ name: 'Color', option: v.color }] : []),
            ],
          })),
        })
      }
      const product = await getProduct(String(made.id))
      if (!product) throw new StoreError('woocommerce: created product not found')
      return product
    },

    async publishProduct(externalId) {
      await call('PUT', `/products/${externalId}`, { status: 'publish' })
    },

    async registerWebhooks(url) {
      const { data: existing } = await call<{ topic: string; delivery_url: string }[]>(
        'GET',
        '/webhooks?per_page=100',
      )
      for (const topic of [
        'product.created',
        'product.updated',
        'product.deleted',
        'order.created',
        'order.updated',
      ]) {
        if (existing.some((w) => w.topic === topic && w.delivery_url === url)) continue
        await call('POST', '/webhooks', {
          name: `SaudaAI ${topic}`,
          topic,
          delivery_url: url,
          secret,
          status: 'active',
        })
      }
    },

    async parseWebhook({ headers, raw }) {
      const sig = headers['x-wc-webhook-signature'] ?? ''
      if (!secret || !sig || !hmacMatches(raw, secret, sig, 'base64')) {
        throw new StoreError('bad webhook signature', 401)
      }
      const topic = headers['x-wc-webhook-topic'] ?? ''
      // Woo pings a new webhook with a form body and no topic.
      if (!topic) return []
      const body = JSON.parse(raw) as { id: number } & Partial<WooOrder>
      const events: StoreEvent[] = []
      if (topic === 'product.created' || topic === 'product.updated') {
        const product = await getProduct(String(body.id))
        events.push(
          product
            ? { type: 'product.upsert', product }
            : { type: 'product.delete', externalId: String(body.id) },
        )
      }
      if (topic === 'product.deleted')
        events.push({ type: 'product.delete', externalId: String(body.id) })
      if (topic === 'order.created' || topic === 'order.updated') {
        events.push({
          type: 'order.upsert',
          externalId: String(body.id),
          status: orderStatus(body.status ?? ''),
          ...(body.date_paid ? { paidPoisha: poisha(body.total ?? '0') } : {}),
        })
      }
      return events
    },
  }
}
