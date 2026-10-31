import type { ExternalOrderInput, ExternalProduct, OrderChange } from '../stores/types.ts'

export const storeUrl = 'https://shop.example.com'

// An in-memory site speaking the SaudaAI Store API, served through a stubbed fetch.
export function fakeStore(products: ExternalProduct[], opts: { totalOffset?: number } = {}) {
  const orders: (ExternalOrderInput & { externalId: string })[] = []
  const changes: { externalId: string; change: OrderChange }[] = []
  const requests: string[] = []

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  async function fetch(input: string | URL | Request, init?: RequestInit) {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    requests.push(`${method} ${url.pathname}`)
    if (
      init?.headers &&
      (init.headers as Record<string, string>).authorization !== 'Bearer tok-12345678'
    ) {
      return reply(401, { error: 'bad token' })
    }
    const path = url.pathname.replace(/^\/saudaai/, '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (path === '/info') return reply(200, { name: 'Demo Site', currency: 'BDT' })
    if (path === '/products') return reply(200, { products })
    const product = path.match(/^\/products\/(.+)$/)
    if (product) {
      const p = products.find((x) => x.externalId === product[1])
      return p ? reply(200, p) : reply(404, { error: 'not found' })
    }
    if (path === '/orders' && method === 'POST') {
      const input = body as ExternalOrderInput
      const externalId = `o${orders.length + 1}`
      orders.push({ ...input, externalId })
      const items = input.lines.reduce((sum, l) => {
        const v = products
          .flatMap((p) => p.variants)
          .find((x) => x.externalId === l.variantExternalId)
        return sum + (v?.pricePoisha ?? 0) * l.qty
      }, 0)
      return reply(200, {
        externalId,
        number: `D-${100 + orders.length}`,
        totalPoisha: items + input.shippingPoisha + (opts.totalOffset ?? 0),
        adminUrl: `${storeUrl}/admin/orders/${externalId}`,
      })
    }
    const order = path.match(/^\/orders\/(.+)$/)
    if (order && method === 'PATCH') {
      changes.push({ externalId: order[1]!, change: body as OrderChange })
      return reply(200, { ok: true })
    }
    return reply(404, { error: `no route ${method} ${path}` })
  }

  return { products, orders, changes, requests, fetch }
}

export const demoProducts = (): ExternalProduct[] => [
  {
    externalId: 'p1',
    name: 'Indigo Block Print Kurti',
    category: 'kurti',
    status: 'active',
    variants: [
      { externalId: 'v1', size: 'M', pricePoisha: 150000, stock: 4 },
      { externalId: 'v2', size: 'L', pricePoisha: 150000, stock: 1 },
    ],
  },
  {
    externalId: 'p2',
    name: 'Jute Tote Bag',
    category: 'bag',
    status: 'active',
    variants: [{ externalId: 'v3', pricePoisha: 50000, stock: null }],
  },
]
