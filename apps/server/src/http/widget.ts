import { widgetMessage } from '@saudaai/shared'
import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { Deps } from '../agent/deps.ts'
import { subscribe, type WebEvent } from '../channels/webchat.ts'
import { newId } from '../db/ids.ts'
import { conversations, messages, shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Inbox } from '../inbox.ts'
import { body } from './body.ts'

const tenMinutes = 10 * 60 * 1000
const hour = 60 * 60 * 1000
const sessionPattern = /^[a-z0-9]{24}$/

function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now: number) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    recent.push(now)
    hits.set(key, recent)
    return recent.length > max
  }
}

// The widget runs on the seller's own site, where our cookies would be third-party and blocked,
// so the browser keeps a session id in localStorage and sends it as a header (or ?session= for SSE).
export function widgetRoutes(deps: Deps, inbox: Inbox) {
  const app = new Hono()
  const { db } = deps
  const perSession = limiter(20, tenMinutes)
  const perShop = limiter(200, hour)

  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['content-type', 'x-saudaai-session'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 86400,
    }),
  )

  async function shopOf(c: Context) {
    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.publicKey, c.req.param('key')!))
    if (!shop) throw new HTTPException(404, { message: 'shop not found' })
    return shop
  }

  function session(c: Context) {
    const sid = c.req.header('x-saudaai-session') ?? c.req.query('session') ?? ''
    if (!sessionPattern.test(sid)) throw new HTTPException(400, { message: 'missing session' })
    return sid
  }

  async function conversationFor(shopId: string, sid: string) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.shopId, shopId),
          eq(conversations.channel, 'webchat'),
          eq(conversations.externalUserId, sid),
        ),
      )
    return conv ?? null
  }

  app.get('/:key', async (c) => {
    const shop = await shopOf(c)
    const given = c.req.header('x-saudaai-session') ?? ''
    return c.json({
      name: shop.name,
      area: shop.area,
      session: sessionPattern.test(given) ? given : `${newId()}${newId()}`,
    })
  })

  app.get('/:key/messages', async (c) => {
    const shop = await shopOf(c)
    const conv = await conversationFor(shop.id, session(c))
    if (!conv) return c.json({ messages: [] })
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.createdAt)
      .limit(100)
    return c.json({
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind,
        text: m.role === 'customer' && m.kind === 'voice' ? m.transcript : m.text,
        imageUrl:
          m.mediaId && m.kind !== 'voice' ? `${env.PUBLIC_BASE_URL}/media/${m.mediaId}` : null,
        at: m.createdAt,
      })),
    })
  })

  app.post('/:key/messages', async (c) => {
    const shop = await shopOf(c)
    const sid = session(c)
    const now = deps.now()
    if (perSession(sid, now) || perShop(shop.id, now)) {
      throw new HTTPException(429, { message: 'too many messages, please wait a little' })
    }
    const base = {
      channel: 'webchat' as const,
      shopId: shop.id,
      externalUserId: sid,
      externalMessageId: newId(),
      receivedAt: now,
    }
    if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
      const form = await c.req.formData()
      const voice = form.get('voice')
      if (!(voice instanceof File) || voice.size > 5_000_000) {
        throw new HTTPException(400, { message: 'voice note missing or too large' })
      }
      const bytes = Buffer.from(await voice.arrayBuffer())
      const productId = form.get('productId')
      await inbox.customer({
        ...base,
        kind: 'voice',
        media: { mime: voice.type || 'audio/webm', fetch: async () => bytes },
        ...(typeof productId === 'string' && productId ? { meta: { productId } } : {}),
      })
    } else {
      const { text, pageUrl, productId } = await body(c, widgetMessage)
      const meta = pageUrl || productId ? { pageUrl, productId } : undefined
      await inbox.customer({ ...base, kind: 'text', text, ...(meta ? { meta } : {}) })
    }
    return c.json({ ok: true }, 202)
  })

  app.get('/:key/stream', async (c) => {
    await shopOf(c)
    const sid = session(c)
    return streamSSE(c, async (stream) => {
      const queue: WebEvent[] = []
      let wake: (() => void) | null = null
      const off = subscribe(sid, (e) => {
        queue.push(e)
        wake?.()
      })
      stream.onAbort(off)
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) })
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, 25_000)
        })
        wake = null
        if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' })
      }
    })
  })

  return app
}
