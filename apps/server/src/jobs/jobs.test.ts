import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { pendingActions, shops } from '../db/schema.ts'
import { fakeDeps } from '../test/deps.ts'
import { testShop } from '../test/shop.ts'
import { dailySummary } from '../tools/reports.ts'
import { draftReminders, summaryText } from './index.ts'

let t: Awaited<ReturnType<typeof testShop>>

beforeEach(async () => {
  t = await testShop()
  await t.db.update(shops).set({ telegramChatId: '42' }).where(eq(shops.id, t.shop.id))
})

describe('draftReminders', () => {
  it('drafts one approval per unpaid order and does not repeat within two days', async () => {
    const f = fakeDeps(t.db)
    const first = await draftReminders(f.deps, t.shop)
    expect(first).toBeGreaterThan(0)
    expect(f.approvals.every((p) => p.tool === 'send_payment_reminder')).toBe(true)
    expect(await draftReminders(f.deps, t.shop)).toBe(0)
    expect(await t.db.select().from(pendingActions)).toHaveLength(first)
  })

  it('skips cash on delivery orders that have not arrived yet', async () => {
    const f = fakeDeps(t.db)
    await draftReminders(f.deps, t.shop)
    const previews = f.approvals.map((p) => p.preview).join('\n')
    expect(previews).not.toContain('Jamil Khan')
  })
})

describe('summaryText', () => {
  it('writes a short end of day message', async () => {
    const text = summaryText(await dailySummary(t.ctx()))
    expect(text).toMatch(/^Today: \d+ orders/)
    expect(text).toContain('Money due:')
  })
})
