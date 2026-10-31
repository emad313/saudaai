import { createHmac, timingSafeEqual } from 'node:crypto'
import PQueue from 'p-queue'
import { StoreError } from './types.ts'

const queues = new Map<string, PQueue>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One request at a time per store: Shopify throttles by query cost and small Woo hosts fall over.
export function queued<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
  let q = queues.get(storeId)
  if (!q) queues.set(storeId, (q = new PQueue({ concurrency: 1 })))
  return q.add(fn) as Promise<T>
}

export async function storeRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    }).catch((err: Error) => {
      throw new StoreError(`${new URL(url).host}: ${err.message}`)
    })
    const retryable = res.status === 429 || res.status >= 500
    if (res.ok || !retryable || attempt >= 2) return res
    const after = Number(res.headers.get('retry-after'))
    await sleep(after > 0 ? Math.min(after, 10) * 1000 : 500 * 2 ** attempt)
  }
}

export async function failure(res: Response) {
  const body = (await res.text()).slice(0, 300)
  const host = res.url ? new URL(res.url).host : 'store'
  return new StoreError(`${host} answered ${res.status}: ${body}`, res.status)
}

export function hmacMatches(
  raw: string,
  secret: string,
  given: string,
  encoding: 'hex' | 'base64',
) {
  const want = createHmac('sha256', secret).update(raw, 'utf8').digest()
  const got = Buffer.from(given, encoding)
  return got.length === want.length && timingSafeEqual(got, want)
}
