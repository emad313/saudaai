import { eq } from 'drizzle-orm'
import { webhookCallback } from 'grammy'
import { Hono } from 'hono'
import {
  messengerProfileName,
  parseMessenger,
  type MessengerPayload,
} from '../channels/messenger.ts'
import { validSignature } from '../channels/meta.ts'
import type { InboundMessage } from '../channels/types.ts'
import { parseWhatsApp, type WhatsAppPayload } from '../channels/whatsapp.ts'
import type { Db } from '../db/client.ts'
import { shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Inbox } from '../inbox.ts'
import { log } from '../log.ts'
import type { Services } from '../services.ts'

// One deployment serves one demo shop; its Page and WhatsApp number are configured by env.
export function channelShop(db: Db) {
  let cached: string | null = null
  return async () => {
    if (cached) return cached
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.slug, env.DEMO_SHOP_SLUG))
    cached = shop?.id ?? null
    return cached
  }
}

export function metaInbound(raw: string, shopId: string): InboundMessage[] {
  const payload = JSON.parse(raw) as { object?: string }
  if (payload.object === 'page') {
    return parseMessenger(payload as MessengerPayload, (pageId) =>
      pageId === env.MESSENGER_PAGE_ID ? shopId : null,
    )
  }
  if (payload.object === 'whatsapp_business_account') {
    return parseWhatsApp(payload as WhatsAppPayload, (id) =>
      id === env.WHATSAPP_PHONE_NUMBER_ID ? shopId : null,
    )
  }
  return []
}

export function webhookRoutes(services: Pick<Services, 'db' | 'inbox' | 'telegram'>) {
  const app = new Hono()
  const shopId = channelShop(services.db)
  const names = new Map<string, string | null>()

  async function withName(m: InboundMessage, inbox: Inbox) {
    if (m.channel === 'messenger' && !m.profileName) {
      if (!names.has(m.externalUserId))
        names.set(m.externalUserId, await messengerProfileName(m.externalUserId))
      m.profileName = names.get(m.externalUserId) ?? undefined
    }
    await inbox.customer(m)
  }

  app.get('/webhooks/meta', (c) => {
    const ok =
      c.req.query('hub.mode') === 'subscribe' &&
      env.META_VERIFY_TOKEN &&
      c.req.query('hub.verify_token') === env.META_VERIFY_TOKEN
    return ok ? c.text(c.req.query('hub.challenge') ?? '') : c.text('forbidden', 403)
  })

  app.post('/webhooks/meta', async (c) => {
    const raw = await c.req.text()
    if (
      !env.META_APP_SECRET ||
      !validSignature(raw, c.req.header('x-hub-signature-256'), env.META_APP_SECRET)
    ) {
      return c.text('bad signature', 401)
    }
    const id = await shopId()
    if (!id) return c.text('ok')
    for (const m of metaInbound(raw, id)) {
      withName(m, services.inbox).catch((err) =>
        log.error({ err, channel: m.channel }, 'inbound message failed'),
      )
    }
    return c.text('ok')
  })

  const bot = services.telegram.bot
  if (bot && env.TELEGRAM_MODE === 'webhook') {
    app.post(
      '/tg/webhook',
      webhookCallback(bot, 'hono', { secretToken: env.TELEGRAM_WEBHOOK_SECRET }),
    )
  }

  return app
}
