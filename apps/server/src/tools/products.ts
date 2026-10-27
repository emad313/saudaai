import { formatTaka } from '@saudaai/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { write } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { products, variants } from '../db/schema.ts'
import { ToolError, type Ctx } from './ctx.ts'
import { normalize, tokens } from './text.ts'

type Product = typeof products.$inferSelect
type Variant = typeof variants.$inferSelect

function variantView(v: Variant) {
  return {
    variantId: v.id,
    size: v.size,
    color: v.color,
    price: formatTaka(v.pricePoisha),
    available: v.stock - v.reserved,
  }
}

function productView(p: Product, vs: Variant[]) {
  return {
    productId: p.id,
    name: p.name,
    category: p.category,
    status: p.status,
    price: formatTaka(p.basePricePoisha),
    hasPhoto: p.imageId !== null,
    variants: vs.map(variantView),
  }
}

function score(query: string[], p: Product, vs: Variant[]): number {
  const haystack = normalize(
    [p.name, p.category, ...p.aliases, ...vs.flatMap((v) => [v.color ?? ''])].join(' '),
  )
  const words = new Set(haystack.split(' '))
  let hits = 0
  for (const q of query) {
    if (words.has(q)) hits += 1
    else if (q.length >= 3 && haystack.includes(q)) hits += 0.6
  }
  return query.length ? hits / query.length : 0
}

export async function loadVariants(ctx: Ctx, productIds: string[]) {
  if (!productIds.length) return new Map<string, Variant[]>()
  const rows = await ctx.db.select().from(variants).where(inArray(variants.productId, productIds))
  const byProduct = new Map<string, Variant[]>()
  for (const v of rows) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v])
  return byProduct
}

export async function findProducts(ctx: Ctx, args: { query: string; limit?: number }) {
  const statuses = ctx.actor === 'customer' ? (['active'] as const) : (['active', 'draft'] as const)
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.shopId, ctx.shop.id), inArray(products.status, [...statuses])))
  const byProduct = await loadVariants(
    ctx,
    rows.map((p) => p.id),
  )
  const query = tokens(args.query)
  const matches = rows
    .map((p) => ({
      p,
      vs: byProduct.get(p.id) ?? [],
      s: score(query, p, byProduct.get(p.id) ?? []),
    }))
    .filter((m) => m.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, args.limit ?? 5)
  return {
    matches: matches.map((m) => ({
      ...productView(m.p, m.vs),
      score: Math.round(m.s * 100) / 100,
    })),
  }
}

export async function requireProduct(ctx: Ctx, productId: string) {
  const [p] = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.shopId, ctx.shop.id)))
  if (!p || (ctx.actor === 'customer' && p.status !== 'active')) {
    throw new ToolError('not_found', `product ${productId} not found`)
  }
  return p
}

export async function getProduct(ctx: Ctx, args: { productId: string }) {
  const p = await requireProduct(ctx, args.productId)
  const vs = (await loadVariants(ctx, [p.id])).get(p.id) ?? []
  return { ...productView(p, vs), attributes: p.attributes }
}

export type VariantInput = { size?: string; color?: string; stock: number; pricePoisha?: number }

export async function createProductDraft(
  ctx: Ctx,
  args: {
    name: string
    category: string
    pricePoisha: number
    variants: VariantInput[]
    aliases?: string[]
    attributes?: Record<string, string | string[]>
    mediaId?: string
  },
) {
  const productId = newId()
  await write(ctx.db, async (tx) => {
    await tx.insert(products).values({
      id: productId,
      shopId: ctx.shop.id,
      name: args.name,
      category: args.category,
      aliases: args.aliases ?? [],
      attributes: args.attributes ?? {},
      basePricePoisha: args.pricePoisha,
      status: 'draft',
      imageId: args.mediaId ?? null,
      createdAt: ctx.now,
    })
    const rows = args.variants.length ? args.variants : [{ stock: 0 }]
    await tx.insert(variants).values(
      rows.map((v) => ({
        id: newId(),
        productId,
        size: v.size ?? null,
        color: v.color ?? null,
        pricePoisha: v.pricePoisha ?? args.pricePoisha,
        stock: v.stock,
      })),
    )
  })
  return getProduct(ctx, { productId })
}

export async function setProductStatus(
  ctx: Ctx,
  args: { productId: string; status: Product['status'] },
) {
  await requireProduct(ctx, args.productId)
  await ctx.db.update(products).set({ status: args.status }).where(eq(products.id, args.productId))
  return getProduct(ctx, { productId: args.productId })
}

export async function updateProduct(
  ctx: Ctx,
  args: { productId: string; name?: string; pricePoisha?: number; status?: Product['status'] },
) {
  const p = await requireProduct(ctx, args.productId)
  await write(ctx.db, async (tx) => {
    await tx
      .update(products)
      .set({
        name: args.name ?? p.name,
        basePricePoisha: args.pricePoisha ?? p.basePricePoisha,
        status: args.status ?? p.status,
      })
      .where(eq(products.id, p.id))
    if (args.pricePoisha !== undefined) {
      // variants that followed the old base price move with it; custom variant prices stay
      await tx
        .update(variants)
        .set({ pricePoisha: args.pricePoisha })
        .where(and(eq(variants.productId, p.id), eq(variants.pricePoisha, p.basePricePoisha)))
    }
  })
  return getProduct(ctx, { productId: p.id })
}

export async function requireVariant(ctx: Ctx, variantId: string) {
  const [row] = await ctx.db
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.id, variantId), eq(products.shopId, ctx.shop.id)))
  if (!row) throw new ToolError('not_found', `variant ${variantId} not found`)
  return row
}

export async function adjustStock(
  ctx: Ctx,
  args: { variantId: string; delta: number; reason: string },
) {
  const { p } = await requireVariant(ctx, args.variantId)
  const res = await ctx.db
    .update(variants)
    .set({ stock: sql`${variants.stock} + ${args.delta}` })
    .where(
      and(
        eq(variants.id, args.variantId),
        sql`${variants.stock} + ${args.delta} >= ${variants.reserved}`,
      ),
    )
  if (res.rowsAffected === 0) {
    const { v } = await requireVariant(ctx, args.variantId)
    throw new ToolError(
      'stock_negative',
      `stock would drop to ${v.stock + args.delta} but ${v.reserved} are reserved by open orders`,
    )
  }
  const { v } = await requireVariant(ctx, args.variantId)
  return { product: p.name, ...variantView(v), stock: v.stock, reason: args.reason }
}
