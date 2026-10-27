import type { Db } from '../db/client.ts'
import type { conversations, pendingActions } from '../db/schema.ts'
import type { Media } from '../media/store.ts'
import type { Models } from '../models/index.ts'
import type { OutboundMessage } from '../channels/types.ts'
import type { Shop } from '../tools/ctx.ts'

export type Conversation = typeof conversations.$inferSelect
export type PendingAction = typeof pendingActions.$inferSelect

export type SellerLine = {
  notify(shop: Shop, text: string, choices?: string[]): Promise<void>
  askApproval(shop: Shop, pending: PendingAction): Promise<void>
  settle(shop: Shop, pending: PendingAction, outcome: string): Promise<void>
  sendMedia(shop: Shop, mediaIds: string[], caption?: string): Promise<void>
}

export type Outbound = {
  send(conversation: Conversation, msg: OutboundMessage): Promise<void>
  typing?(conversation: Conversation): Promise<void>
}

export type AdFormat = 'square' | 'story'

export type Renderer = {
  invoice(shop: Shop, orderId: string): Promise<Media>
  ad(
    shop: Shop,
    input: { productId: string; occasion?: string; offerText?: string; formats: AdFormat[] },
  ): Promise<Media[]>
}

export type Deps = {
  db: Db
  models: Models
  seller: SellerLine
  outbound: Outbound
  render: Renderer
  now(): number
}
