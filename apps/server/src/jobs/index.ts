import { Cron } from 'croner'
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm'
import type { Deps } from '../agent/deps.ts'
import { sellerConversation } from '../agent/messaging.ts'
import { expirePending, proposeOrRun } from '../agent/pending.ts'
import type { TurnCtx } from '../agent/registry.ts'
import { newId } from '../db/ids.ts'
import { pendingActions, shops } from '../db/schema.ts'
import { log } from '../log.ts'
import type { Shop } from '../tools/ctx.ts'
import { ordersDue } from '../tools/orders.ts'
import { dailySummary } from '../tools/reports.ts'

const hour = 60 * 60 * 1000

async function systemCtx(deps: Deps, shop: Shop): Promise<TurnCtx> {
  const conversation = shop.telegramChatId
    ? await sellerConversation(deps, shop.id, shop.telegramChatId)
    : null
  return {
    db: deps.db,
    deps,
    shop,
    actor: 'system',
    now: deps.now(),
    conversation,
    turnId: `job_${newId()}`,
    inputKind: 'text',
  }
}

export async function draftReminders(deps: Deps, shop: Shop, olderThanHours = 24) {
  const ctx = await systemCtx(deps, shop)
  const due = await ordersDue(ctx, ctx.now - olderThanHours * hour)
  let drafted = 0
  for (const order of due) {
    const [recent] = await deps.db
      .select({ id: pendingActions.id })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.shopId, shop.id),
          eq(pendingActions.tool, 'send_payment_reminder'),
          sql`json_extract(${pendingActions.args}, '$.orderId') = ${order.orderId}`,
          gt(pendingActions.createdAt, ctx.now - 48 * hour),
        ),
      )
    if (recent) continue
    await proposeOrRun(ctx, 'send_payment_reminder', { orderId: order.orderId }).catch(
      (err: Error) =>
        log.warn({ err: err.message, orderId: order.orderId }, 'reminder not drafted'),
    )
    drafted++
  }
  return drafted
}

export function summaryText(s: Awaited<ReturnType<typeof dailySummary>>) {
  const top = s.today.topProducts.map((t) => `${t.name} x${t.qty}`).join(', ') || '-'
  const low = s.lowStock.map((l) => `${l.item} (${l.available})`).join(', ') || 'none'
  return [
    `Today: ${s.today.orders} orders, ${s.today.revenue} sold, ${s.today.collected} collected, ${s.today.expenses} spent.`,
    `Top: ${top}`,
    `Low stock: ${low}`,
    `Money due: ${s.dues.due} on ${s.dues.orders} orders`,
    s.draftOrders ? `Draft orders waiting: ${s.draftOrders}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

async function linkedShops(deps: Deps) {
  return deps.db.select().from(shops).where(isNotNull(shops.telegramChatId))
}

export function startJobs(deps: Deps) {
  const guard = (name: string, fn: () => Promise<void>) => async () => {
    try {
      await fn()
    } catch (err) {
      log.error({ err, job: name }, 'job failed')
    }
  }
  const jobs = [
    new Cron(
      '*/10 * * * *',
      guard('expire', async () => {
        for (const shop of await deps.db.select().from(shops)) await expirePending(deps, shop)
      }),
    ),
    new Cron(
      '5 10-21 * * *',
      { timezone: 'Asia/Dhaka' },
      guard('reminders', async () => {
        for (const shop of await linkedShops(deps)) {
          const n = await draftReminders(deps, shop)
          if (n) log.info({ shopId: shop.id, n }, 'payment reminders drafted')
        }
      }),
    ),
    new Cron(
      '0 22 * * *',
      { timezone: 'Asia/Dhaka' },
      guard('summary', async () => {
        for (const shop of await linkedShops(deps)) {
          const s = await dailySummary({ db: deps.db, shop, actor: 'system', now: deps.now() })
          await deps.seller.notify(
            shop,
            summaryText(s),
            s.dues.orders ? ['Send payment reminders'] : undefined,
          )
        }
      }),
    ),
  ]
  return () => jobs.forEach((j) => j.stop())
}
