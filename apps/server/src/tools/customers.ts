import { and, eq, like, or } from 'drizzle-orm'
import { newId } from '../db/ids.ts'
import { customers } from '../db/schema.ts'
import { ToolError, type Ctx } from './ctx.ts'
import { normalizePhone } from './text.ts'

type Customer = typeof customers.$inferSelect

export function customerView(c: Customer) {
  return { customerId: c.id, name: c.name, phone: c.phone, address: c.address, area: c.area }
}

export async function findCustomers(ctx: Ctx, args: { query: string }) {
  const phone = normalizePhone(args.query)
  const q = `%${args.query.trim().toLowerCase()}%`
  const rows = await ctx.db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.shopId, ctx.shop.id),
        phone ? eq(customers.phone, phone) : or(like(customers.name, q), like(customers.phone, q)),
      ),
    )
    .limit(5)
  return { matches: rows.map(customerView) }
}

export async function requireCustomer(ctx: Ctx, customerId: string) {
  const [c] = await ctx.db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, ctx.shop.id)))
  if (!c) throw new ToolError('not_found', `customer ${customerId} not found`)
  return c
}

export async function createCustomer(
  ctx: Ctx,
  args: { name: string; phone?: string; address?: string; area?: string },
) {
  const phone = args.phone ? normalizePhone(args.phone) : null
  if (args.phone && !phone) {
    throw new ToolError('bad_phone', `${args.phone} is not a valid Bangladeshi mobile number`)
  }
  if (phone) {
    const [existing] = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, ctx.shop.id), eq(customers.phone, phone)))
    if (existing) {
      const updated = {
        address: args.address ?? existing.address,
        area: args.area ?? existing.area,
      }
      await ctx.db.update(customers).set(updated).where(eq(customers.id, existing.id))
      return { ...customerView({ ...existing, ...updated }), existing: true }
    }
  }
  const row = {
    id: newId(),
    shopId: ctx.shop.id,
    name: args.name,
    phone,
    address: args.address ?? null,
    area: args.area ?? null,
    notes: null,
    createdAt: ctx.now,
  }
  await ctx.db.insert(customers).values(row)
  return { ...customerView(row), existing: false }
}
