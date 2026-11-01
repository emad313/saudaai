import { parseTaka } from '@saudaai/shared'
import { normalizePhone } from '../tools/text.ts'
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

type Money = { shopMoney: { amount: string } } | null
type GqlOrder = {
  id: string
  name: string
  createdAt: string
  cancelledAt: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string
  tags: string[]
  totalPriceSet: Money
  totalReceivedSet: Money
  totalShippingPriceSet: Money
  paymentGatewayNames: string[]
  customer: { displayName: string; phone: string | null; email: string | null } | null
  shippingAddress: {
    name: string | null
    address1: string | null
    city: string | null
    phone: string | null
  } | null
  lineItems: {
    nodes: {
      quantity: number
      originalUnitPriceSet: Money
      variant: { id: string; product: { id: string } } | null
    }[]
  }
}

const orderFields = `id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus tags
  totalPriceSet { shopMoney { amount } } totalReceivedSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } }
  paymentGatewayNames customer { displayName phone email } shippingAddress { name address1 city phone }
  lineItems(first: 100) { nodes { quantity originalUnitPriceSet { shopMoney { amount } } variant { id product { id } } } }`

const money = (m: Money) => poisha(m?.shopMoney.amount ?? '0')

function fromGqlOrder(o: GqlOrder, domain: string): StoreOrder {
  const total = money(o.totalPriceSet)
  const paid =
    o.displayFinancialStatus === 'PAID' ? total : Math.min(money(o.totalReceivedSet), total)
  const ship = o.shippingAddress
  return {
    externalId: o.id,
    number: o.name,
    status: o.cancelledAt
      ? 'cancelled'
      : o.tags.includes('delivered')
        ? 'delivered'
        : o.displayFulfillmentStatus === 'FULFILLED'
          ? 'shipped'
          : 'confirmed',
    createdAt: Date.parse(o.createdAt),
    customer: {
      name: o.customer?.displayName || ship?.name || 'Customer',
      phone: o.customer?.phone ?? ship?.phone ?? undefined,
      email: o.customer?.email ?? undefined,
      address: ship?.address1 ?? undefined,
      area: ship?.city ?? undefined,
    },
    lines: o.lineItems.nodes
      .filter((l) => l.variant)
      .map((l) => ({
        variantExternalId: l.variant!.id,
        productExternalId: l.variant!.product.id,
        qty: l.quantity,
        unitPricePoisha: money(l.originalUnitPriceSet),
      })),
    shippingPoisha: money(o.totalShippingPriceSet),
    totalPoisha: total,
    paidPoisha: paid,
    paymentMethod: /cash|cod/i.test(o.paymentGatewayNames.join(' '))
      ? 'cod'
      : o.paymentGatewayNames[0],
    adminUrl: `https://${domain}/admin/orders/${o.id.split('/').pop()}`,
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
      // Shopify only takes E.164; customers are stored as local 01XXXXXXXXX.
      const local = input.customer.phone ? normalizePhone(input.customer.phone) : null
      const phone = local ? `+88${local}` : undefined
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
              priceWithCurrency: {
                amount: decimal(input.shippingPoisha),
                currencyCode: row.currency,
              },
            },
            shippingAddress: {
              firstName: first,
              lastName: rest.join(' ') || undefined,
              address1: input.customer.address ?? input.customer.area,
              city: input.customer.area,
              countryCode: 'BD',
              phone,
            },
            phone,
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

    async getOrder(externalId) {
      const data = await gql<{ order: GqlOrder | null }>(
        `query($id: ID!) { order(id: $id) { ${orderFields} } }`,
        { id: externalId },
      )
      return data.order ? fromGqlOrder(data.order, domain) : null
    },

    async listOrders(since, cursor) {
      const data = await gql<{
        orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlOrder[] }
      }>(
        `query($cursor: String, $q: String) { orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT) { pageInfo { hasNextPage endCursor } nodes { ${orderFields} } } }`,
        { cursor: cursor ?? null, q: `created_at:>='${new Date(since).toISOString()}'` },
      )
      const { pageInfo, nodes } = data.orders
      return {
        orders: nodes.map((o) => fromGqlOrder(o, domain)).filter((o) => o.lines.length),
        next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined,
      }
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
      // Shopify would happily go negative; stock never does here.
      const now = level.quantities[0]?.quantity ?? 0
      if (now + delta < 0) throw new StoreError(`only ${now} in stock`, 409)
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

    // Shopify has no hero-banner API; a blog article with the banner is the closest public post.
    async publishPost(post) {
      const data = await gql<{ blogs: { nodes: { id: string; handle: string }[] } }>(
        `{ blogs(first: 1) { nodes { id handle } } }`,
      )
      const blog = data.blogs.nodes[0]
      if (!blog) throw new StoreError('shopify: the store has no blog to post to', 404)
      const res = await gql<{
        articleCreate: { article: { handle: string } | null; userErrors: { message: string }[] }
      }>(
        `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { article { handle } userErrors { message } } }`,
        {
          article: {
            blogId: blog.id,
            title: post.title,
            body: `<p>${post.body.replace(/[&<>]/g, (ch) => `&#${ch.charCodeAt(0)};`)}</p>`,
            image: { url: post.imageUrl },
            isPublished: true,
            author: { name: row.name },
          },
        },
      )
      userErrors(res.articleCreate)
      return { url: `https://${domain}/blogs/${blog.handle}/${res.articleCreate.article!.handle}` }
    },

    async publishProduct(externalId) {
      const res = await gql<{ productUpdate: { userErrors: { message: string }[] } }>(
        `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { message } } }`,
        { product: { id: externalId, status: 'ACTIVE' } },
      )
      userErrors(res.productUpdate)
    },

    // Subscriptions made through the API are signed with the app secret we already hold.
    async registerWebhooks(url) {
      const refused: { topic: string; reason: string }[] = []
      for (const topic of [
        'PRODUCTS_CREATE',
        'PRODUCTS_UPDATE',
        'PRODUCTS_DELETE',
        'INVENTORY_LEVELS_UPDATE',
        'ORDERS_CREATE',
        'ORDERS_UPDATED',
      ]) {
        const res = await gql<{
          webhookSubscriptionCreate: { userErrors: { message: string }[] }
        }>(
          `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { userErrors { message } } }`,
          { topic, sub: { callbackUrl: url, format: 'JSON' } },
        )
        const err = res.webhookSubscriptionCreate.userErrors[0]
        if (err && !/already been taken/i.test(err.message)) {
          refused.push({ topic: topic.toLowerCase().replace('_', '/'), reason: err.message })
        }
      }
      return refused
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
