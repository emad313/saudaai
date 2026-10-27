import { formatTaka } from '@saudaai/shared'
import { newId } from '../db/ids.ts'
import { expenses } from '../db/schema.ts'
import { ToolError, type Ctx } from './ctx.ts'

export async function recordExpense(
  ctx: Ctx,
  args: { amountPoisha: number; category: string; note?: string },
) {
  if (args.amountPoisha <= 0) throw new ToolError('bad_amount', 'expense must be positive')
  const row = {
    id: newId(),
    shopId: ctx.shop.id,
    amountPoisha: args.amountPoisha,
    category: args.category,
    note: args.note ?? null,
    createdAt: ctx.now,
  }
  await ctx.db.insert(expenses).values(row)
  return { expenseId: row.id, amount: formatTaka(row.amountPoisha), category: row.category }
}
