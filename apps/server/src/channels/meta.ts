import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.ts'
import { request } from '../models/http.ts'

export function graphUrl(path: string) {
  return `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${path.replace(/^\//, '')}`
}

export function validSignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw).digest()
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function graph(path: string, token: string, body: unknown | FormData) {
  const form = body instanceof FormData
  const res = await request(graphUrl(path), {
    headers: {
      authorization: `Bearer ${token}`,
      ...(form ? {} : { 'content-type': 'application/json' }),
    },
    body: form ? body : JSON.stringify(body),
    timeoutMs: 20_000,
  })
  return (await res.json()) as Record<string, unknown>
}

export async function graphGet(path: string, token: string) {
  const res = await request(graphUrl(path), {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  })
  return (await res.json()) as Record<string, unknown>
}

export async function download(url: string, token?: string): Promise<Buffer> {
  const res = await request(url, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    timeoutMs: 30_000,
  })
  return Buffer.from(await res.arrayBuffer())
}
