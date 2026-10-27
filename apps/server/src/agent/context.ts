import { formatTaka } from '@saudaai/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { messages, products } from '../db/schema.ts'
import type { ChatMessage } from '../models/chat.ts'
import type { Ctx } from '../tools/ctx.ts'
import { listOrders } from '../tools/orders.ts'
import { loadVariants } from '../tools/products.ts'

export async function catalogBlock(ctx: Ctx) {
  const statuses = ctx.actor === 'customer' ? (['active'] as const) : (['active', 'draft'] as const)
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.shopId, ctx.shop.id), inArray(products.status, [...statuses])))
    .orderBy(desc(products.createdAt))
    .limit(50)
  const byProduct = await loadVariants(
    ctx,
    rows.map((p) => p.id),
  )
  const lines = rows.map((p) => {
    const vs = (byProduct.get(p.id) ?? [])
      .map(
        (v) =>
          `${v.id}:${[v.size, v.color].filter(Boolean).join('/') || 'one'}=${v.stock - v.reserved}`,
      )
      .join(' ')
    const draft = p.status === 'draft' ? ' (draft)' : ''
    const photo = p.imageId ? ' [photo]' : ''
    return `${p.id} | ${p.name}${draft}${photo} | ${formatTaka(p.basePricePoisha)} | ${vs}`
  })
  return `Catalog (productId | name | price | variantId:size/color=available):\n${lines.join('\n') || '(empty)'}`
}

async function ordersBlock(ctx: Ctx) {
  if (ctx.actor === 'customer') {
    if (!ctx.customerId) return 'This customer has no orders with us yet.'
    const mine = await listOrders(ctx, { customerId: ctx.customerId, limit: 5 })
    return `This customer's orders:\n${mine.map((o) => `#${o.number} ${o.status} ${o.paymentStatus} ${o.total}`).join('\n') || '(none)'}`
  }
  const open = await listOrders(ctx, { status: ['draft', 'confirmed', 'shipped'], limit: 10 })
  return `Open orders (orderId | number | customer | status | payment | total):\n${
    open
      .map(
        (o) =>
          `${o.orderId} | #${o.number} | ${o.customer} | ${o.status} | ${o.paymentMethod} ${o.paymentStatus} | ${o.total}`,
      )
      .join('\n') || '(none)'
  }`
}

export async function contextBlock(ctx: Ctx) {
  const [catalog, open] = await Promise.all([catalogBlock(ctx), ordersBlock(ctx)])
  return `${catalog}\n\n${open}`
}

export async function history(
  ctx: Ctx,
  conversationId: string,
  limit = 12,
): Promise<ChatMessage[]> {
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
  return rows.reverse().flatMap((m): ChatMessage[] => {
    const body = m.transcript ?? m.text
    const text =
      m.kind === 'photo' && m.role !== 'agent'
        ? `[sent a photo${m.mediaId ? ` mediaId=${m.mediaId}` : ''}] ${body ?? ''}`.trim()
        : m.kind === 'voice'
          ? `[voice note] ${body ?? ''}`.trim()
          : (body ?? '')
    if (!text) return []
    return m.role === 'agent' || m.role === 'system'
      ? [{ role: 'assistant', content: text }]
      : [{ role: 'user', content: text }]
  })
}
