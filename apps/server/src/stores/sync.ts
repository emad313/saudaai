import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { write, type Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { orders, orderStatuses, products, stores, variants } from '../db/schema.ts'
import { log } from '../log.ts'
import type { StoreRow } from './index.ts'
import type { ExternalProduct, StoreConnector, StoreEvent } from './types.ts'

type Status = (typeof orderStatuses)[number]

export async function applyProduct(db: Db, store: StoreRow, p: ExternalProduct, now: number) {
  return write(db, async (tx) => {
    const [local] = await tx
      .select()
      .from(products)
      .where(and(eq(products.storeId, store.id), eq(products.externalId, p.externalId)))
    const prices = p.variants.map((v) => v.pricePoisha)
    const fields = {
      name: p.name,
      category: (p.category ?? local?.category ?? 'other').toLowerCase(),
      basePricePoisha: prices.length ? Math.min(...prices) : (local?.basePricePoisha ?? 0),
      status: p.status,
      imageUrl: p.imageUrl ?? null,
    }
    const productId = local?.id ?? newId()
    if (local) await tx.update(products).set(fields).where(eq(products.id, productId))
    else {
      await tx.insert(products).values({
        id: productId,
        shopId: store.shopId,
        storeId: store.id,
        externalId: p.externalId,
        aliases: [],
        attributes: {},
        createdAt: now,
        ...fields,
      })
    }

    const existing = await tx.select().from(variants).where(eq(variants.productId, productId))
    for (const v of p.variants) {
      const values = {
        size: v.size ?? null,
        color: v.color ?? null,
        sku: v.sku ?? null,
        pricePoisha: v.pricePoisha,
        stock: v.stock === null ? null : Math.max(0, v.stock),
        reserved: 0,
      }
      const match = existing.find((e) => e.externalId === v.externalId)
      if (match) await tx.update(variants).set(values).where(eq(variants.id, match.id))
      else
        await tx
          .insert(variants)
          .values({ id: newId(), productId, externalId: v.externalId, ...values })
    }
    // Variants the store dropped stay for old order lines but can no longer be sold.
    const gone = existing.filter((e) => !p.variants.some((v) => v.externalId === e.externalId))
    if (gone.length) {
      await tx
        .update(variants)
        .set({ stock: 0 })
        .where(
          inArray(
            variants.id,
            gone.map((g) => g.id),
          ),
        )
    }
    return productId
  })
}

async function applyEvent(db: Db, store: StoreRow, e: StoreEvent, now: number) {
  switch (e.type) {
    case 'product.upsert':
      await applyProduct(db, store, e.product, now)
      return
    case 'product.delete':
      await db
        .update(products)
        .set({ status: 'archived' })
        .where(and(eq(products.storeId, store.id), eq(products.externalId, e.externalId)))
      return
    case 'stock': {
      const ids = db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.storeId, store.id))
      await db
        .update(variants)
        .set({ stock: Math.max(0, e.stock) })
        .where(and(eq(variants.externalId, e.variantExternalId), inArray(variants.productId, ids)))
      return
    }
    case 'order.upsert': {
      const [o] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.storeId, store.id), eq(orders.externalId, e.externalId)))
      // Orders placed directly on the store are not imported; only ours are kept in step.
      if (!o) return
      const status = (orderStatuses as readonly string[]).includes(e.status)
        ? (e.status as Status)
        : o.status
      const paid = Math.min(e.paidPoisha ?? o.paidPoisha, o.totalPoisha)
      await db
        .update(orders)
        .set({
          status,
          paidPoisha: paid,
          paymentStatus: paid === 0 ? 'unpaid' : paid >= o.totalPoisha ? 'paid' : 'partial',
          updatedAt: now,
        })
        .where(eq(orders.id, o.id))
    }
  }
}

export async function applyEvents(db: Db, store: StoreRow, events: StoreEvent[], now: number) {
  for (const e of events) await applyEvent(db, store, e, now)
}

export async function pullStore(db: Db, store: StoreRow, connector: StoreConnector, now: number) {
  await db.update(stores).set({ status: 'syncing' }).where(eq(stores.id, store.id))
  try {
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await connector.listProducts(cursor)
      for (const p of page.products) {
        await applyProduct(db, store, p, now)
        seen.push(p.externalId)
      }
      cursor = page.next
    } while (cursor)
    await db
      .update(products)
      .set({ status: 'archived' })
      .where(
        and(
          eq(products.storeId, store.id),
          seen.length ? notInArray(products.externalId, seen) : undefined,
        ),
      )
    await db
      .update(stores)
      .set({ status: 'connected', lastSyncAt: now, lastError: null })
      .where(eq(stores.id, store.id))
    log.info({ storeId: store.id, products: seen.length }, 'store synced')
    return { products: seen.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(stores)
      .set({ status: 'error', lastError: message.slice(0, 500) })
      .where(eq(stores.id, store.id))
    throw err
  }
}
