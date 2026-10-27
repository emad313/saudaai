import type { Channel } from '../db/schema.ts'

export type CustomerChannel = Exclude<Channel, 'telegram_seller'>

export type InboundMessage = {
  channel: CustomerChannel
  shopId: string
  externalUserId: string
  externalMessageId: string
  kind: 'text' | 'voice' | 'image' | 'location' | 'unsupported'
  text?: string
  media?: { mime: string; fetch: () => Promise<Buffer> }
  profileName?: string
  receivedAt: number
}

export type OutboundMessage =
  | { kind: 'text'; text: string; quickReplies?: string[] }
  | { kind: 'image'; mediaId: string; caption?: string }
  | { kind: 'template'; name: string; params: string[]; fallbackText: string }
