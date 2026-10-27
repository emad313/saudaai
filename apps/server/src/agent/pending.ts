import { and, eq, lt } from 'drizzle-orm'
import { newId } from '../db/ids.ts'
import { orders, pendingActions } from '../db/schema.ts'
import { log } from '../log.ts'
import { ToolError, type Shop } from '../tools/ctx.ts'
import { updateOrderStatus } from '../tools/orders.ts'
import { cancelledReply } from './copy.ts'
import type { Deps, PendingAction } from './deps.ts'
import { conversationById, customerConversation, sendToCustomer } from './messaging.ts'
import { asSeller, toolByName, type TurnCtx } from './registry.ts'

const dayMs = 24 * 60 * 60 * 1000

export async function propose(ctx: TurnCtx, name: string, args: Record<string, unknown>) {
  const def = toolByName.get(name)
  if (!def) throw new Error(`unknown tool ${name}`)
  const preview = def.preview ? await def.preview(asSeller(ctx), args as never) : `Run ${name}?`
  const row: PendingAction = {
    id: newId(),
    shopId: ctx.shop.id,
    conversationId:
      ctx.conversation?.channel === 'telegram_seller' ? null : (ctx.conversation?.id ?? null),
    tool: name,
    args,
    preview,
    status: 'pending',
    result: null,
    telegramMessageId: null,
    expiresAt: ctx.now + dayMs,
    decidedAt: null,
    createdAt: ctx.now,
  }
  await ctx.db.insert(pendingActions).values(row)
  await ctx.deps.seller.askApproval(ctx.shop, row)
  return { pending: true as const, pendingId: row.id, waitingFor: 'seller approval', preview }
}

export async function proposeOrRun(ctx: TurnCtx, name: string, args: Record<string, unknown>) {
  const def = toolByName.get(name)!
  const guarded = def.guard ? await def.guard(ctx, args as never) : false
  if (guarded) return propose(ctx, name, args)
  return { pending: false as const, result: await def.run(asSeller(ctx), args as never) }
}

async function load(deps: Deps, shop: Shop, id: string) {
  const [row] = await deps.db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, id), eq(pendingActions.shopId, shop.id)))
  if (!row) throw new ToolError('not_found', 'this request no longer exists')
  if (row.status !== 'pending') throw new ToolError('decided', `already ${row.status}`)
  if (row.expiresAt < deps.now()) throw new ToolError('expired', 'this request expired')
  return row
}

async function settle(
  deps: Deps,
  row: PendingAction,
  status: PendingAction['status'],
  result: unknown,
) {
  await deps.db
    .update(pendingActions)
    .set({ status, result, decidedAt: deps.now() })
    .where(eq(pendingActions.id, row.id))
}

async function ctxFor(deps: Deps, shop: Shop, row: PendingAction): Promise<TurnCtx> {
  const conversation = row.conversationId ? await conversationById(deps, row.conversationId) : null
  return {
    db: deps.db,
    deps,
    shop,
    actor: 'seller',
    now: deps.now(),
    conversation,
    conversationId: conversation?.id,
    customerId: conversation?.customerId ?? null,
    turnId: `pa_${row.id}`,
    inputKind: 'text',
  }
}

export async function approve(deps: Deps, shop: Shop, id: string, text?: string) {
  const row = await load(deps, shop, id)
  const def = toolByName.get(row.tool)!
  const args = text !== undefined ? { ...row.args, text } : row.args
  const parsed = def.schema.safeParse(args)
  if (!parsed.success) throw new ToolError('invalid', parsed.error.issues[0]?.message ?? 'invalid')
  const ctx = await ctxFor(deps, shop, row)
  try {
    const result = await def.run(ctx, parsed.data as never)
    await settle(deps, row, text !== undefined ? 'edited' : 'approved', result)
    const line = def.done ? def.done(result as never) : 'Done'
    await deps.seller.settle(shop, row, line)
    return { ok: true as const, line, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await settle(deps, row, 'failed', { error: message })
    await deps.seller.settle(shop, row, `Could not do it: ${message}`)
    if (!(err instanceof ToolError)) log.error({ err, pendingId: row.id }, 'approved action failed')
    return { ok: false as const, line: message }
  }
}

async function releaseCustomerOrder(deps: Deps, shop: Shop, row: PendingAction) {
  if (row.tool !== 'send_order_confirmation') return
  const orderId = String(row.args.orderId)
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, orderId))
  if (!order || order.status !== 'draft') return
  const ctx = await ctxFor(deps, shop, row)
  await updateOrderStatus(ctx, { orderId, status: 'cancelled' })
  if (order.source !== 'customer_chat') return
  const conv = await customerConversation(deps, shop.id, order.customerId, order.conversationId)
  if (conv) {
    await sendToCustomer(deps, conv, { kind: 'text', text: cancelledReply(order.number) }).catch(
      (err) => log.warn({ err, orderId }, 'could not tell customer about cancelled order'),
    )
  }
}

export async function cancel(deps: Deps, shop: Shop, id: string) {
  const row = await load(deps, shop, id)
  await settle(deps, row, 'cancelled', null)
  await releaseCustomerOrder(deps, shop, row)
  await deps.seller.settle(shop, row, 'Cancelled')
}

export async function expirePending(deps: Deps, shop: Shop) {
  const rows = await deps.db
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.shopId, shop.id),
        eq(pendingActions.status, 'pending'),
        lt(pendingActions.expiresAt, deps.now()),
      ),
    )
  for (const row of rows) {
    await settle(deps, row, 'expired', null)
    await releaseCustomerOrder(deps, shop, row)
    await deps.seller.settle(shop, row, 'Expired after 24 hours')
  }
  return rows.length
}

export function isEditable(row: PendingAction) {
  return 'text' in row.args
}
