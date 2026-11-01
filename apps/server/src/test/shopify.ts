import { readFileSync } from 'node:fs'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/shopify/${name}.json`, import.meta.url), 'utf8'))

export const shopifyDomain = 'test-shop.myshopify.com'

// Answers Admin GraphQL from fixtures, keyed on the operation in the query text.
export function fakeShopify(
  opts: {
    throttleFirst?: boolean
    currency?: string
    noCustomerData?: boolean
    noShipping?: boolean
  } = {},
) {
  const ops: { op: string; variables: Record<string, unknown> }[] = []
  const uploads: { url: string; fields: string[] }[] = []
  let throttled = !opts.throttleFirst

  const ok = (data: unknown) => Response.json({ data })
  const none = { userErrors: [] }

  async function fetch(input: string | URL | Request, init?: RequestInit) {
    const url = String(input)
    const headers = init?.headers as Record<string, string>
    if (url.startsWith('https://shopify-staged-uploads.example/')) {
      uploads.push({ url, fields: [...(init?.body as FormData).keys()] })
      return new Response(null, { status: 201 })
    }
    if (!url.startsWith(`https://${shopifyDomain}/admin/api/`))
      return new Response('', { status: 404 })
    if (headers['x-shopify-access-token'] !== 'shpat_test_token') {
      return Response.json({ errors: '[API] Invalid API key or access token' }, { status: 401 })
    }
    const { query, variables } = JSON.parse(String(init?.body)) as {
      query: string
      variables: Record<string, unknown>
    }
    if (!throttled) {
      throttled = true
      return Response.json({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      })
    }
    const has = (word: string) => query.includes(word)
    const op = [
      'stagedUploadsCreate',
      'productCreate',
      'productVariantsBulkCreate',
      'locations(first',
      'webhookSubscriptionCreate',
      'paymentCollectionDetails',
      'articleCreate',
      'blogs(first',
      'orders(first',
      'order(id: $id) { id name',
      'draftOrderCreate',
      'draftOrderComplete',
      'draftOrderDelete',
      'orderCancel',
      'fulfillmentCreate',
      'fulfillmentOrders',
      'tagsAdd',
      'orderMarkAsPaid',
      'orderUpdate',
      'order(id: $id) { note',
      'inventoryAdjustQuantities',
      'inventoryItem(id',
      'productVariant(id',
      'totalPriceSet { shopMoney { amount } } } }',
      'products(first',
      'product(id',
      'shop {',
    ].find(has)
    ops.push({ op: op ?? 'unknown', variables })

    switch (op) {
      case 'shop {':
        return ok({ shop: { name: 'SaudaAI Demo Shop', currencyCode: opts.currency ?? 'BDT' } })
      case 'products(first':
        return Response.json(fixture(variables.cursor ? 'products-2' : 'products-1'))
      case 'product(id': {
        const all = [
          ...fixture('products-1').data.products.nodes,
          ...fixture('products-2').data.products.nodes,
        ]
        return ok({ product: all.find((p: { id: string }) => p.id === variables.id) ?? null })
      }
      case 'webhookSubscriptionCreate':
        return ok({
          webhookSubscriptionCreate: {
            userErrors: String(variables.topic).startsWith('ORDERS')
              ? [{ message: 'You cannot create a webhook subscription with the specified topic' }]
              : [],
          },
        })
      case 'stagedUploadsCreate':
        return ok({
          stagedUploadsCreate: {
            stagedTargets: [
              {
                url: 'https://shopify-staged-uploads.example/upload',
                resourceUrl: 'https://shopify-staged-uploads.example/tmp/abc/photo.jpg',
                parameters: [{ name: 'key', value: 'tmp/abc/photo.jpg' }],
              },
            ],
            ...none,
          },
        })
      case 'productCreate':
        return ok({ productCreate: { product: { id: 'gid://shopify/Product/8001' }, ...none } })
      case 'productVariantsBulkCreate':
        return ok({ productVariantsBulkCreate: none })
      case 'locations(first':
        return ok({ locations: { nodes: [{ id: 'gid://shopify/Location/1' }] } })
      case 'paymentCollectionDetails':
        return ok({
          order: {
            paymentCollectionDetails: {
              additionalPaymentCollectionUrl: `https://${shopifyDomain}/pay/5551`,
            },
          },
        })
      case 'blogs(first':
        return ok({ blogs: { nodes: [{ id: 'gid://shopify/Blog/1', handle: 'news' }] } })
      case 'articleCreate':
        return ok({ articleCreate: { article: { handle: 'eid-collection' }, userErrors: [] } })
      case 'orders(first':
        return ok({
          orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [fixture('order')] },
        })
      case 'order(id: $id) { id name':
        return ok({ order: variables.id === fixture('order').id ? fixture('order') : null })
      case 'draftOrderCreate':
        if (opts.noCustomerData) {
          return Response.json({
            errors: [
              {
                message:
                  'This app is not approved to access the DraftOrder object. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details.',
                extensions: { code: 'ACCESS_DENIED' },
              },
            ],
          })
        }
        return ok({
          draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/777' }, ...none },
        })
      case 'draftOrderComplete':
        if (opts.noShipping) {
          return ok({
            draftOrderComplete: {
              draftOrder: null,
              userErrors: [
                {
                  message:
                    'Your cart has been updated and the items you added can’t be shipped to your address. Remove the items to complete your order.',
                },
              ],
            },
          })
        }
        return Response.json(fixture('draft-complete'))
      case 'draftOrderDelete':
        return ok({ draftOrderDelete: none })
      case 'totalPriceSet { shopMoney { amount } } } }':
        return ok({ order: { totalPriceSet: { shopMoney: { amount: '3060.00' } } } })
      case 'fulfillmentOrders':
        return ok({
          order: {
            fulfillmentOrders: {
              nodes: [{ id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN' }],
            },
          },
        })
      case 'inventoryItem(id':
        return ok({ inventoryItem: { variant: { id: 'gid://shopify/ProductVariant/9002' } } })
      case 'productVariant(id':
        return ok({
          productVariant: {
            inventoryItem: {
              id: 'gid://shopify/InventoryItem/42',
              inventoryLevels: {
                nodes: [
                  { location: { id: 'gid://shopify/Location/1' }, quantities: [{ quantity: 4 }] },
                ],
              },
            },
          },
        })
      case 'order(id: $id) { note':
        return ok({ order: { note: null } })
      case 'orderCancel':
        return ok({ orderCancel: { orderCancelUserErrors: [] } })
      case undefined:
        return Response.json({ errors: [{ message: `unexpected query: ${query.slice(0, 60)}` }] })
      default:
        return ok({ [op.replace(/[^a-zA-Z].*$/, '')]: none })
    }
  }

  return { ops, uploads, fetch }
}
