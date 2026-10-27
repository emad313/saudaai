import type { conversations } from '../db/schema.ts'

const windowMs = 24 * 60 * 60 * 1000 - 10 * 60 * 1000

export function canSendFreeform(c: typeof conversations.$inferSelect, now: number): boolean {
  if (c.channel === 'webchat' || c.channel === 'telegram_seller') return true
  return now - c.lastInboundAt < windowMs
}
