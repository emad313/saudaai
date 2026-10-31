import { parseTaka } from '@saudaai/shared'
import type { Credentials, StoreRow } from './index.ts'
import { decimal, failure, hmacMatches, queued, storeRequest } from './http.ts'
import {
  StoreError,
  type ExternalProduct,
  type ExternalVariant,
  type StoreConnector,
  type StoreEvent,
} from './types.ts'

const version = '2025-01'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type GqlVariant = {
  id: string
  sku: string | null
  price: string
  selectedOptions: { name: string; value: string }[]
  inventoryQuantity: number | null
  inventoryItem: { tracked: boolean }
}
type GqlProduct = {
  id: string
  title: string
  productType: string
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  featuredMedia: { preview: { image: { url: string } | null } | null } | null
  variants: { nodes: GqlVariant[] }
}

const productFields = `id title productType status
  featuredMedia { preview { image { url } } }
  variants(first: 100) { nodes { id sku price selectedOptions { name value } inventoryQuantity inventoryItem { tracked } } }`

const poisha = (value: string | number) => parseTaka(String(value)) ?? 0

function option(options: { name: string; value: string }[], pattern: RegExp) {
  const o = options.find((x) => pattern.test(x.name) && x.value !== 'Default Title')
  return o?.value
}

function fromGql(p: GqlProduct): ExternalProduct {
  return {
    externalId: p.id,
    name: p.title,
    category: p.productType || undefined,
    imageUrl: p.featuredMedia?.preview?.image?.url,
    status: p.status.toLowerCase() as ExternalProduct['status'],
    variants: p.variants.nodes.map((v): ExternalVariant => ({
      externalId: v.id,
      size: option(v.selectedOptions, /size|সাইজ/i),
      color: option(v.selectedOptions, /colou?r|রং/i),
      sku: v.sku ?? undefined,
      pricePoisha: poisha(v.price),
      stock: v.inventoryItem.tracked ? (v.inventoryQuantity ?? 0) : null,
    })),
  }
}

// Webhooks carry the REST shape with numeric ids; the GraphQL ids are rebuilt from them.
type RestProduct = {
  id: number
  title: string
  product_type?: string
  status?: string
  image?: { src?: string } | null
  options?: { name: string; position: number }[]
  variants?: {
    id: number
    sku?: string | null
    price: string
    inventory_quantity?: number
    inventory_management?: string | null
    option1?: string | null
    option2?: string | null
    option3?: string | null
  }[]
}

function fromRest(p: RestProduct): ExternalProduct {
  const at = (v: NonNullable<RestProduct['variants']>[number], pattern: RegExp) => {
    const o = (p.options ?? []).find((x) => pattern.test(x.name))
    const value = o ? v[`option${o.position}` as 'option1'] : null
    return value && value !== 'Default Title' ? value : undefined
  }
  return {
    externalId: `gid://shopify/Product/${p.id}`,
    name: p.title,
    category: p.product_type || undefined,
    imageUrl: p.image?.src,
    status: (p.status ?? 'active') as ExternalProduct['status'],
    variants: (p.variants ?? []).map((v) => ({
      externalId: `gid://shopify/ProductVariant/${v.id}`,
      size: at(v, /size|সাইজ/i),
      color: at(v, /colou?r|রং/i),
      sku: v.sku ?? undefined,
      pricePoisha: poisha(v.price),
      stock: v.inventory_management ? (v.inventory_quantity ?? 0) : null,
    })),
  }
}

export function shopifyConnector(
  row: StoreRow,
  creds: Credentials,
  secret: string,
): StoreConnector {
  const domain = (row.baseUrl ?? '').replace(/^https?:\/\//, '')
  const numeric = (gid: string) => gid.split('/').pop()

  async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await queued(row.id, () =>
        storeRequest(`https://${domain}/admin/api/${version}/graphql.json`, {
          method: 'POST',
          headers: { 'x-shopify-access-token': creds.accessToken ?? '' },
          body: { query, variables },
        }),
      )
      if (!res.ok) throw await failure(res)
      const body = (await res.json()) as {
        data?: T
        errors?: { message: string; extensions?: { code?: string } }[]
      }
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED')
      if (throttled && attempt < 3) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      if (body.errors?.length) throw new StoreError(`shopify: ${body.errors[0]!.message}`)
      return body.data as T
    }
  }

  function userErrors(result: { userErrors?: { message: string }[] } | null | undefined) {
    const first = result?.userErrors?.[0]
    if (first) throw new StoreError(`shopify: ${first.message}`)
  }

  async function location() {
    const data = await gql<{ locations: { nodes: { id: string }[] } }>(
      `{ locations(first: 1) { nodes { id } } }`,
    )
    const id = data.locations.nodes[0]?.id
    if (!id) throw new StoreError('shopify: the store has no location for inventory')
    return id
  }

  async function addNote(orderId: string, line: string) {
    const data = await gql<{ order: { note: string | null } | null }>(
      `query($id: ID!) { order(id: $id) { note } }`,
      { id: orderId },
    )
    const note = [data.order?.note, line].filter(Boolean).join('\n')
    const res = await gql<{ orderUpdate: { userErrors: { message: string }[] } }>(
      `mutation($input: OrderInput!) { orderUpdate(input: $input) { userErrors { message } } }`,
      { input: { id: orderId, note } },
    )
    userErrors(res.orderUpdate)
  }

  async function fulfil(orderId: string) {
    const data = await gql<{
      order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } } | null
    }>(
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }`,
      { id: orderId },
    )
    const open = (data.order?.fulfillmentOrders.nodes ?? []).filter((f) =>
      ['OPEN', 'IN_PROGRESS'].includes(f.status),
    )
    if (!open.length) return
    const res = await gql<{ fulfillmentCreate: { userErrors: { message: string }[] } }>(
      `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { userErrors { message } } }`,
      {
        f: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })),
        },
      },
    )
    userErrors(res.fulfillmentCreate)
  }

  return {
    kind: 'shopify',

    async test() {
      try {
        const data = await gql<{ shop: { name: string; currencyCode: string } }>(
          `{ shop { name currencyCode } }`,
        )
        if (data.shop.currencyCode !== 'BDT') {
          return {
            ok: false,
            error: `store currency is ${data.shop.currencyCode}; only BDT is supported yet`,
          }
        }
        return { ok: true, name: data.shop.name, currency: data.shop.currencyCode }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async listProducts(cursor) {
      const data = await gql<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: GqlProduct[]
        }
      }>(
        `query($cursor: String) { products(first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${productFields} } } }`,
        { cursor: cursor ?? null },
      )
      const { pageInfo, nodes } = data.products
      return {
        products: nodes.map(fromGql),
        next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined,
      }
    },

    async getProduct(externalId) {
      const data = await gql<{ product: GqlProduct | null }>(
        `query($id: ID!) { product(id: $id) { ${productFields} } }`,
        { id: externalId },
      )
      return data.product ? fromGql(data.product) : null
    },

    // Draft then complete with payment pending: the order lands unpaid, like cash on delivery.
    async createOrder(input) {
      const [first, ...rest] = input.customer.name.trim().split(/\s+/)
      const draft = await gql<{
        draftOrderCreate: { draftOrder: { id: string } | null; userErrors: { message: string }[] }
      }>(
        `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { message } } }`,
        {
          input: {
            lineItems: input.lines.map((l) => ({
              variantId: l.variantExternalId,
              quantity: l.qty,
            })),
            shippingLine: {
              title: 'Delivery',
              priceWithCurrency: { amount: decimal(input.shippingPoisha), currencyCode: 'BDT' },
            },
            shippingAddress: {
              firstName: first,
              lastName: rest.join(' ') || undefined,
              address1: input.customer.address ?? input.customer.area,
              city: input.customer.area,
              countryCode: 'BD',
              phone: input.customer.phone,
            },
            phone: input.customer.phone,
            email: input.customer.email,
            note: [input.note, `Payment: ${input.paymentMethod}`].filter(Boolean).join('\n'),
            tags: input.tags,
          },
        },
      )
      userErrors(draft.draftOrderCreate)
      const done = await gql<{
        draftOrderComplete: {
          draftOrder: {
            order: {
              id: string
              name: string
              totalPriceSet: { shopMoney: { amount: string } }
            } | null
          } | null
          userErrors: { message: string }[]
        }
      }>(
        `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { order { id name totalPriceSet { shopMoney { amount } } } } userErrors { message } } }`,
        { id: draft.draftOrderCreate.draftOrder!.id },
      )
      userErrors(done.draftOrderComplete)
      const order = done.draftOrderComplete.draftOrder?.order
      if (!order) throw new StoreError('shopify: draft order did not become an order')
      return {
        externalId: order.id,
        number: order.name,
        totalPoisha: poisha(order.totalPriceSet.shopMoney.amount),
        adminUrl: `https://${domain}/admin/orders/${numeric(order.id)}`,
      }
    },

    async updateOrder(externalId, change) {
      if (change.status === 'cancelled') {
        const res = await gql<{ orderCancel: { orderCancelUserErrors: { message: string }[] } }>(
          `mutation($id: ID!) { orderCancel(orderId: $id, reason: CUSTOMER, refund: false, restock: true, notifyCustomer: false) { orderCancelUserErrors { message } } }`,
          { id: externalId },
        )
        const first = res.orderCancel.orderCancelUserErrors[0]
        if (first) throw new StoreError(`shopify: ${first.message}`)
      }
      if (change.status === 'shipped') await fulfil(externalId)
      if (change.status === 'delivered') {
        const res = await gql<{ tagsAdd: { userErrors: { message: string }[] } }>(
          `mutation($id: ID!) { tagsAdd(id: $id, tags: ["delivered"]) { userErrors { message } } }`,
          { id: externalId },
        )
        userErrors(res.tagsAdd)
      }
      if (change.paidPoisha !== undefined) {
        const data = await gql<{
          order: { totalPriceSet: { shopMoney: { amount: string } } } | null
        }>(`query($id: ID!) { order(id: $id) { totalPriceSet { shopMoney { amount } } } }`, {
          id: externalId,
        })
        const total = poisha(data.order?.totalPriceSet.shopMoney.amount ?? '0')
        if (change.paidPoisha >= total) {
          const res = await gql<{ orderMarkAsPaid: { userErrors: { message: string }[] } }>(
            `mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { userErrors { message } } }`,
            { input: { id: externalId } },
          )
          userErrors(res.orderMarkAsPaid)
        }
      }
      if (change.note) await addNote(externalId, change.note)
    },

    async adjustStock(variantExternalId, delta) {
      const data = await gql<{
        productVariant: {
          inventoryItem: {
            id: string
            inventoryLevels: {
              nodes: { location: { id: string }; quantities: { quantity: number }[] }[]
            }
          }
        } | null
      }>(
        `query($id: ID!) { productVariant(id: $id) { inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } quantities(names: ["available"]) { quantity } } } } } }`,
        { id: variantExternalId },
      )
      const item = data.productVariant?.inventoryItem
      const level = item?.inventoryLevels.nodes[0]
      if (!item || !level) throw new StoreError('shopify: this variant has no inventory level')
      const res = await gql<{ inventoryAdjustQuantities: { userErrors: { message: string }[] } }>(
        `mutation($input: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $input) { userErrors { message } } }`,
        {
          input: {
            reason: 'correction',
            name: 'available',
            changes: [{ delta, inventoryItemId: item.id, locationId: level.location.id }],
          },
        },
      )
      userErrors(res.inventoryAdjustQuantities)
      return (level.quantities[0]?.quantity ?? 0) + delta
    },

    async createProduct(p) {
      const sizes = [...new Set(p.variants.map((v) => v.size).filter(Boolean))] as string[]
      const colors = [...new Set(p.variants.map((v) => v.color).filter(Boolean))] as string[]
      const options = [
        ...(sizes.length ? [{ name: 'Size', values: sizes.map((name) => ({ name })) }] : []),
        ...(colors.length ? [{ name: 'Color', values: colors.map((name) => ({ name })) }] : []),
      ]
      const made = await gql<{
        productCreate: { product: { id: string } | null; userErrors: { message: string }[] }
      }>(
        `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) { product { id } userErrors { message } } }`,
        {
          product: {
            title: p.name,
            productType: p.category,
            status: 'DRAFT',
            ...(options.length ? { productOptions: options } : {}),
          },
          media: p.imageUrl ? [{ originalSource: p.imageUrl, mediaContentType: 'IMAGE' }] : [],
        },
      )
      userErrors(made.productCreate)
      const productId = made.productCreate.product!.id
      const locationId = await location()
      const res = await gql<{ productVariantsBulkCreate: { userErrors: { message: string }[] } }>(
        `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkCreate(productId: $id, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) { userErrors { message } } }`,
        {
          id: productId,
          variants: p.variants.map((v) => ({
            price: decimal(v.pricePoisha),
            optionValues: [
              ...(v.size ? [{ optionName: 'Size', name: v.size }] : []),
              ...(v.color ? [{ optionName: 'Color', name: v.color }] : []),
            ],
            inventoryItem: { tracked: true },
            inventoryQuantities: [{ availableQuantity: v.stock ?? 0, locationId }],
          })),
        },
      )
      userErrors(res.productVariantsBulkCreate)
      const product = await this.getProduct(productId)
      if (!product) throw new StoreError('shopify: created product not found')
      return product
    },

    async publishProduct(externalId) {
      const res = await gql<{ productUpdate: { userErrors: { message: string }[] } }>(
        `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { message } } }`,
        { product: { id: externalId, status: 'ACTIVE' } },
      )
      userErrors(res.productUpdate)
    },

    async parseWebhook({ headers, raw }) {
      const sig = headers['x-shopify-hmac-sha256'] ?? ''
      if (!secret || !sig || !hmacMatches(raw, secret, sig, 'base64')) {
        throw new StoreError('bad webhook signature', 401)
      }
      const topic = headers['x-shopify-topic'] ?? ''
      const body = JSON.parse(raw) as Record<string, unknown>
      return shopifyEvents(topic, body, async (itemId) => {
        const data = await gql<{ inventoryItem: { variant: { id: string } | null } | null }>(
          `query($id: ID!) { inventoryItem(id: $id) { variant { id } } }`,
          { id: `gid://shopify/InventoryItem/${itemId}` },
        )
        return data.inventoryItem?.variant?.id ?? null
      })
    },
  }
}

async function shopifyEvents(
  topic: string,
  body: Record<string, unknown>,
  variantOf: (inventoryItemId: number) => Promise<string | null>,
): Promise<StoreEvent[]> {
  if (topic === 'products/create' || topic === 'products/update') {
    return [{ type: 'product.upsert', product: fromRest(body as unknown as RestProduct) }]
  }
  if (topic === 'products/delete') {
    return [{ type: 'product.delete', externalId: `gid://shopify/Product/${body.id}` }]
  }
  if (topic === 'inventory_levels/update') {
    const variant = await variantOf(Number(body.inventory_item_id))
    return variant
      ? [{ type: 'stock', variantExternalId: variant, stock: Number(body.available ?? 0) }]
      : []
  }
  if (topic === 'orders/create' || topic === 'orders/updated') {
    const o = body as {
      id: number
      cancelled_at?: string | null
      financial_status?: string
      fulfillment_status?: string | null
      total_price?: string
      tags?: string
    }
    const delivered = (o.tags ?? '').split(',').some((t) => t.trim() === 'delivered')
    const status = o.cancelled_at
      ? 'cancelled'
      : delivered
        ? 'delivered'
        : o.fulfillment_status === 'fulfilled'
          ? 'shipped'
          : 'confirmed'
    return [
      {
        type: 'order.upsert',
        externalId: `gid://shopify/Order/${o.id}`,
        status,
        ...(o.financial_status === 'paid' ? { paidPoisha: poisha(o.total_price ?? '0') } : {}),
      },
    ]
  }
  return []
}
