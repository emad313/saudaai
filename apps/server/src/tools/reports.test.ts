import { beforeEach, describe, expect, it } from 'vitest'
import { testShop } from '../test/shop.ts'
import { dailySales, salesReport } from './reports.ts'

let t: Awaited<ReturnType<typeof testShop>>

beforeEach(async () => {
  t = await testShop()
})

describe('dailySales', () => {
  it('matches the sales report day by day and over the week', async () => {
    const days = await dailySales(t.ctx())
    expect(days).toHaveLength(7)
    expect(days.at(-1)!.date).toBe('2026-10-28')

    for (const d of days) {
      const report = await salesReport(t.ctx(), { from: d.date, to: d.date })
      expect(d.revenuePoisha).toBe(report.revenuePoisha)
      expect(d.orders).toBe(report.orders)
    }

    const week = await salesReport(t.ctx(), { from: days[0]!.date, to: days.at(-1)!.date })
    expect(days.reduce((s, d) => s + d.revenuePoisha, 0)).toBe(week.revenuePoisha)
    expect(week.orders).toBeGreaterThan(0)
  })
})
