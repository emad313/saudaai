import { and, eq, gte, sql } from 'drizzle-orm'
import PQueue from 'p-queue'
import type { Conversation, Deps } from './agent/deps.ts'
import { runTurn } from './agent/loop.ts'
import { sellerConversation } from './agent/messaging.ts'
import { describeCustomerPhoto, photoNote, processProductPhoto } from './catalog/photo.ts'
import type { InboundMessage } from './channels/types.ts'
import { newId } from './db/ids.ts'
import { conversations, customerIdentities, messages, shops } from './db/schema.ts'
import { log } from './log.ts'
import { saveMedia } from './media/store.ts'
import type { Shop } from './tools/ctx.ts'

const tenMinutes = 10 * 60 * 1000
const perUserLimit = 30

export type SellerInput = {
  chatId: string
  messageId: string
  kind: 'text' | 'voice' | 'photo'
  text?: string
  media?: { bytes: Buffer; mime: string }
}

export type Inbox = ReturnType<typeof createInbox>

export function createInbox(
  deps: Deps,
  hooks: { transcript?: (shop: Shop, text: string) => Promise<void> } = {},
) {
  const queues = new Map<string, PQueue>()
  const queue = (shopId: string) => {
    let q = queues.get(shopId)
    if (!q) queues.set(shopId, (q = new PQueue({ concurrency: 1 })))
    return q
  }
  const limited = new Set<string>()

  async function shopById(id: string) {
    const [s] = await deps.db.select().from(shops).where(eq(shops.id, id))
    return s ?? null
  }

  async function upsertConversation(m: InboundMessage) {
    const now = deps.now()
    await deps.db
      .insert(conversations)
      .values({
        id: newId(),
        shopId: m.shopId,
        channel: m.channel,
        externalUserId: m.externalUserId,
        profileName: m.profileName ?? null,
        lastInboundAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [conversations.shopId, conversations.channel, conversations.externalUserId],
        set: { lastInboundAt: now, ...(m.profileName ? { profileName: m.profileName } : {}) },
      })
    const [c] = await deps.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.shopId, m.shopId),
          eq(conversations.channel, m.channel),
          eq(conversations.externalUserId, m.externalUserId),
        ),
      )
    if (c && !c.customerId) {
      const [identity] = await deps.db
        .select()
        .from(customerIdentities)
        .where(
          and(
            eq(customerIdentities.channel, m.channel),
            eq(customerIdentities.externalUserId, m.externalUserId),
          ),
        )
      if (identity) {
        await deps.db
          .update(conversations)
          .set({ customerId: identity.customerId })
          .where(eq(conversations.id, c.id))
        return { ...c, customerId: identity.customerId }
      }
    }
    return c!
  }

  async function overLimit(conv: Conversation) {
    const [row] = await deps.db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.role, 'customer'),
          gte(messages.createdAt, deps.now() - tenMinutes),
        ),
      )
    return Number(row?.n ?? 0) > perUserLimit
  }

  async function handleCustomer(
    shop: Shop,
    conv: Conversation,
    messageId: string,
    m: InboundMessage,
    bytes?: Buffer,
  ) {
    let note: string | null = null
    if (m.kind === 'voice' && bytes) {
      note = await deps.models.transcribe(bytes, m.media!.mime)
    } else if (m.kind === 'image' && bytes) {
      note = await describeCustomerPhoto(deps, bytes, m.text ?? '')
    }
    if (note !== null)
      await deps.db.update(messages).set({ transcript: note }).where(eq(messages.id, messageId))

    const [fresh] = await deps.db.select().from(conversations).where(eq(conversations.id, conv.id))
    if (fresh!.pausedUntil && fresh!.pausedUntil > deps.now()) {
      const said = note ?? m.text ?? `[${m.kind}]`
      await deps.seller.notify(
        shop,
        `[${conv.channel}] ${conv.profileName ?? 'Customer'}: ${said}\nYou are handling this chat. /reply ${conv.id} <text> or /resume ${conv.id}`,
      )
      return
    }
    await runTurn(deps, {
      shop,
      actor: 'customer',
      conversation: fresh!,
      inputKind: m.kind === 'voice' ? 'voice' : 'text',
    })
  }

  async function customer(m: InboundMessage) {
    const shop = await shopById(m.shopId)
    if (!shop) return log.warn({ shopId: m.shopId }, 'message for unknown shop')
    const conv = await upsertConversation(m)
    if (await overLimit(conv)) {
      if (!limited.has(conv.id)) {
        limited.add(conv.id)
        await deps.seller.notify(
          shop,
          `Too many messages from ${conv.profileName ?? conv.externalUserId} on ${conv.channel}, the assistant stopped replying to them.`,
        )
      }
      return
    }
    limited.delete(conv.id)
    const bytes = m.media ? await m.media.fetch() : undefined
    const stored = bytes ? await saveMedia(deps.db, bytes, m.media!.mime) : null
    const messageId = newId()
    const inserted = await deps.db
      .insert(messages)
      .values({
        id: messageId,
        conversationId: conv.id,
        externalMessageId: m.externalMessageId,
        role: 'customer',
        kind:
          m.kind === 'image'
            ? 'photo'
            : m.kind === 'voice'
              ? 'voice'
              : m.kind === 'location'
                ? 'location'
                : 'text',
        text: m.text ?? (m.kind === 'unsupported' ? '[unsupported message]' : null),
        mediaId: stored?.id ?? null,
        createdAt: m.receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id })
    if (!inserted.length)
      return log.debug({ externalMessageId: m.externalMessageId }, 'duplicate webhook')
    queue(shop.id)
      .add(() => handleCustomer(shop, conv, messageId, m, bytes))
      .catch((err) => log.error({ err, conversationId: conv.id }, 'customer message failed'))
  }

  async function seller(shop: Shop, input: SellerInput) {
    const conv = await sellerConversation(deps, shop.id, input.chatId)
    await deps.db
      .update(conversations)
      .set({ lastInboundAt: deps.now() })
      .where(eq(conversations.id, conv.id))
    return queue(shop.id).add(async () => {
      let text = input.text ?? ''
      let mediaId: string | null = null
      if (input.kind === 'voice' && input.media) {
        mediaId = (await saveMedia(deps.db, input.media.bytes, input.media.mime)).id
        text = await deps.models.transcribe(input.media.bytes, input.media.mime)
        await hooks.transcript?.(shop, text)
      }
      if (input.kind === 'photo' && input.media) {
        const photo = await processProductPhoto(deps, input.media.bytes, input.text ?? '')
        mediaId = photo.original.id
        text = photoNote(photo, input.text ?? '')
      }
      await deps.db.insert(messages).values({
        id: newId(),
        conversationId: conv.id,
        externalMessageId: input.messageId,
        role: 'seller',
        kind: input.kind,
        text: input.kind === 'voice' ? null : (input.text ?? null),
        transcript: input.kind === 'text' ? null : text,
        mediaId,
        createdAt: deps.now(),
      })
      const [fresh] = await deps.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conv.id))
      return runTurn(deps, { shop, actor: 'seller', conversation: fresh!, inputKind: input.kind })
    })
  }

  return { customer, seller, idle: () => Promise.all([...queues.values()].map((q) => q.onIdle())) }
}
