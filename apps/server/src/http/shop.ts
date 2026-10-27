import { chatMessage, orderForm } from '@saudaai/shared'
import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { Deps } from '../agent/deps.ts'
import { orderReceivedReply } from '../agent/copy.ts'
import { logMessage } from '../agent/messaging.ts'
import { toolByName, type TurnCtx } from '../agent/registry.ts'
import { subscribe, type WebEvent } from '../channels/webchat.ts'
import { newId } from '../db/ids.ts'
import { conversations, messages, products, shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Inbox } from '../inbox.ts'
import { loadVariants } from '../tools/products.ts'
import { body } from './body.ts'

const cookie = 'wsid'
const tenMinutes = 10 * 60 * 1000
const hour = 60 * 60 * 1000

function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now: number) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    recent.push(now)
    hits.set(key, recent)
    return recent.length > max
  }
}

export function shopRoutes(deps: Deps, inbox: Inbox) {
  const app = new Hono()
  const { db } = deps
  const perSession = limiter(20, tenMinutes)
  const perShop = limiter(200, hour)

  async function shopOf(c: Context) {
    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.slug, c.req.param('slug')!))
    if (!shop) throw new HTTPException(404, { message: 'shop not found' })
    return shop
  }

  function session(c: Context) {
    const existing = getCookie(c, cookie)
    if (existing && /^[a-z0-9]{24}$/.test(existing)) return existing
    const id = `${newId()}${newId()}`
    setCookie(c, cookie, id, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 90 * 24 * 60 * 60,
    })
    return id
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

  app.get('/:slug', async (c) => {
    const shop = await shopOf(c)
    session(c)
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.shopId, shop.id), eq(products.status, 'active')))
    const byProduct = await loadVariants(
      { db, shop, actor: 'customer', now: deps.now() },
      rows.map((p) => p.id),
    )
    return c.json({
      name: shop.name,
      area: shop.area,
      paymentMethods: shop.paymentMethods,
      delivery: {
        insideDhakaPoisha: shop.deliveryRules.insideDhakaPoisha,
        outsideDhakaPoisha: shop.deliveryRules.outsideDhakaPoisha,
      },
      products: rows.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        pricePoisha: p.basePricePoisha,
        imageUrl: p.imageId ? `/media/${p.imageId}` : null,
        variants: (byProduct.get(p.id) ?? []).map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          pricePoisha: v.pricePoisha,
          available: v.stock - v.reserved,
        })),
      })),
    })
  })

  app.get('/:slug/messages', async (c) => {
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
        imageUrl: m.mediaId && m.kind !== 'voice' ? `/media/${m.mediaId}` : null,
        at: m.createdAt,
      })),
    })
  })

  app.post('/:slug/messages', async (c) => {
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
      await inbox.customer({
        ...base,
        kind: 'voice',
        media: { mime: voice.type || 'audio/webm', fetch: async () => bytes },
      })
    } else {
      const { text } = await body(c, chatMessage)
      await inbox.customer({ ...base, kind: 'text', text })
    }
    return c.json({ ok: true }, 202)
  })

  app.get('/:slug/stream', async (c) => {
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

  app.post('/:slug/order', async (c) => {
    const shop = await shopOf(c)
    const sid = session(c)
    const form = await body(c, orderForm)
    const now = deps.now()
    await db
      .insert(conversations)
      .values({
        id: newId(),
        shopId: shop.id,
        channel: 'webchat',
        externalUserId: sid,
        lastInboundAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [conversations.shopId, conversations.channel, conversations.externalUserId],
        set: { lastInboundAt: now },
      })
    const conversation = (await conversationFor(shop.id, sid))!
    const ctx: TurnCtx = {
      db,
      deps,
      shop,
      actor: 'customer',
      now,
      conversation,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      turnId: `form_${newId()}`,
      inputKind: 'text',
    }
    const result = (await toolByName.get('place_order')!.run(ctx, form as never)) as {
      number: number
      total: string
      status: string
    }
    await logMessage(deps, conversation.id, 'agent', {
      kind: 'text',
      text: orderReceivedReply(result.number),
    })
    return c.json(result)
  })

  return app
}
