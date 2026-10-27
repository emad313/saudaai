import type { Db } from '../db/client.ts'
import type { shops } from '../db/schema.ts'

export type Shop = typeof shops.$inferSelect
export type Actor = 'seller' | 'customer' | 'system'

export type Ctx = {
  db: Db
  shop: Shop
  actor: Actor
  now: number
  conversationId?: string
  customerId?: string | null
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
