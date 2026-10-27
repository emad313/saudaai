import { and, desc, eq, ne } from 'drizzle-orm'
import { newId } from '../db/ids.ts'
import { conversations, messages } from '../db/schema.ts'
import type { OutboundMessage } from '../channels/types.ts'
import { canSendFreeform } from '../channels/window.ts'
import { ToolError } from '../tools/ctx.ts'
import type { Conversation, Deps } from './deps.ts'

export async function conversationById(deps: Deps, id: string) {
  const [c] = await deps.db.select().from(conversations).where(eq(conversations.id, id))
  return c ?? null
}

export async function customerConversation(
  deps: Deps,
  shopId: string,
  customerId: string,
  preferId?: string | null,
): Promise<Conversation | null> {
  if (preferId) {
    const c = await conversationById(deps, preferId)
    if (c && c.channel !== 'telegram_seller') return c
  }
  const [latest] = await deps.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.shopId, shopId),
        eq(conversations.customerId, customerId),
        ne(conversations.channel, 'telegram_seller'),
      ),
    )
    .orderBy(desc(conversations.lastInboundAt))
    .limit(1)
  return latest ?? null
}

export async function sellerConversation(deps: Deps, shopId: string, chatId: string) {
  const now = deps.now()
  await deps.db
    .insert(conversations)
    .values({
      id: newId(),
      shopId,
      channel: 'telegram_seller',
      externalUserId: chatId,
      lastInboundAt: now,
      createdAt: now,
    })
    .onConflictDoNothing()
  const [c] = await deps.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.shopId, shopId),
        eq(conversations.channel, 'telegram_seller'),
        eq(conversations.externalUserId, chatId),
      ),
    )
  return c!
}

export async function logMessage(
  deps: Deps,
  conversationId: string,
  role: 'seller' | 'agent' | 'system',
  msg: OutboundMessage,
) {
  await deps.db.insert(messages).values({
    id: newId(),
    conversationId,
    role,
    kind: msg.kind === 'image' ? 'photo' : 'text',
    text:
      msg.kind === 'image'
        ? (msg.caption ?? null)
        : msg.kind === 'text'
          ? msg.text
          : msg.fallbackText,
    mediaId: msg.kind === 'image' ? msg.mediaId : null,
    deliveryStatus: 'sent',
    createdAt: deps.now(),
  })
}

export async function sendToCustomer(
  deps: Deps,
  conversation: Conversation,
  msg: OutboundMessage,
  role: 'agent' | 'seller' = 'agent',
) {
  if (msg.kind !== 'template' && !canSendFreeform(conversation, deps.now())) {
    throw new ToolError(
      'outside_window',
      'customer last wrote more than 24 hours ago; the platform only allows replies inside that window',
    )
  }
  await deps.outbound.send(conversation, msg)
  await logMessage(deps, conversation.id, role, msg)
}
