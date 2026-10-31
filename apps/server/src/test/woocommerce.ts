import { readFileSync } from 'node:fs'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/woocommerce/${name}.json`, import.meta.url), 'utf8'))

export const wooUrl = 'https://nusrat-shop.example'
const auth = `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`

// WooCommerce REST v3 from fixtures, paginated with X-WP-TotalPages like the real API.
export function fakeWoo(opts: { currency?: string } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Response.json(body, { status, headers })

  async function fetch(input: string | URL | Request, init?: RequestInit) {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const path = url.pathname.replace('/wp-json/wc/v3', '')
    calls.push({ method, path, body })
    if (url.pathname === '/wp-json/') return json({ name: "Nusrat's Shop" })
    if ((init?.headers as Record<string, string>).authorization !== auth) {
      return json(
        { code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.' },
        401,
      )
    }
    if (path === '/settings/general/woocommerce_currency')
      return json({ id: 'woocommerce_currency', value: opts.currency ?? 'BDT' })
    if (path === '/products' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const all = fixture('products')
      return json([all[page - 1]].filter(Boolean), 200, { 'x-wp-totalpages': String(all.length) })
    }
    const variations = path.match(/^\/products\/(\d+)\/variations$/)
    if (variations) return json(variations[1] === '101' ? fixture('variations-101') : [])
    const one = path.match(/^\/products\/(\d+)$/)
    if (one && method === 'GET') {
      const p = fixture('products').find((x: { id: number }) => String(x.id) === one[1])
      return p ? json(p) : json({ code: 'woocommerce_rest_product_invalid_id' }, 404)
    }
    const variation = path.match(/^\/products\/\d+\/variations\/(\d+)$/)
    if (variation && method === 'GET') {
      return json(
        fixture('variations-101').find((v: { id: number }) => String(v.id) === variation[1]),
      )
    }
    if (path === '/webhooks' && method === 'GET') return json([])
    if (path === '/orders' && method === 'POST') return json(fixture('order'), 201)
    if (/^\/orders\/\d+$/.test(path) && method === 'GET') return json(fixture('order'))
    return json({ ok: true })
  }

  return { calls, fetch }
}
