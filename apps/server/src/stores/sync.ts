import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { write, type Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import {
  customers,
  orderLines,
  orders,
  orderStatuses,
  payments,
  products,
  shops,
  stores,
  variants,
} from '../db/schema.ts'
import { log } from '../log.ts'
import { normalizePhone } from '../tools/text.ts'
import type { StoreRow } from './index.ts'
import type { ExternalProduct, StoreConnector, StoreEvent, StoreOrder } from './types.ts'

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
    // A new store photo replaces the cached copy on next use.
    const stale = local && local.imageUrl !== fields.imageUrl ? { imageId: null } : {}
    if (local)
      await tx
        .update(products)
        .set({ ...fields, ...stale })
        .where(eq(products.id, productId))
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

async function applyEvent(
  db: Db,
  store: StoreRow,
  connector: StoreConnector,
  e: StoreEvent,
  now: number,
): Promise<Imported | null> {
  switch (e.type) {
    case 'product.upsert':
      await applyProduct(db, store, e.product, now)
      return null
    case 'product.delete':
      await db
        .update(products)
        .set({ status: 'archived' })
        .where(and(eq(products.storeId, store.id), eq(products.externalId, e.externalId)))
      return null
    case 'stock': {
      const ids = db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.storeId, store.id))
      await db
        .update(variants)
        .set({ stock: Math.max(0, e.stock) })
        .where(and(eq(variants.externalId, e.variantExternalId), inArray(variants.productId, ids)))
      return null
    }
    case 'order.upsert': {
      const [o] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.storeId, store.id), eq(orders.externalId, e.externalId)))
      if (!o) {
        // Placed on the website itself: the event has no lines, so read the whole order.
        const full = await connector.getOrder(e.externalId)
        return full ? importOrder(db, store, connector, full, now) : null
      }
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
      return null
    }
  }
}

export async function applyEvents(
  db: Db,
  store: StoreRow,
  connector: StoreConnector,
  events: StoreEvent[],
  now: number,
) {
  const imported: Imported[] = []
  for (const e of events) {
    const done = await applyEvent(db, store, connector, e, now)
    if (done) imported.push(done)
  }
  return imported
}

export type Imported = {
  orderId: string
  number: number
  externalNumber: string
  totalPoisha: number
}

async function variantFor(
  db: Db,
  store: StoreRow,
  connector: StoreConnector,
  line: StoreOrder['lines'][number],
  now: number,
) {
  const find = async () => {
    const [v] = await db
      .select({ id: variants.id })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(products.storeId, store.id), eq(variants.externalId, line.variantExternalId)))
    return v?.id ?? null
  }
  const known = await find()
  if (known || !line.productExternalId) return known
  const product = await connector.getProduct(line.productExternalId)
  if (product) await applyProduct(db, store, product, now)
  return find()
}

async function customerFor(db: Db, shopId: string, c: StoreOrder['customer'], now: number) {
  const phone = c.phone ? normalizePhone(c.phone) : null
  if (phone) {
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, shopId), eq(customers.phone, phone)))
    if (existing) return existing.id
  }
  const id = newId()
  await db.insert(customers).values({
    id,
    shopId,
    name: c.name,
    phone,
    address: c.address ?? null,
    area: c.area ?? null,
    notes: null,
    createdAt: now,
  })
  return id
}

// An order the customer placed on the website: mirror it so chats, reminders and analytics see it.
export async function importOrder(
  db: Db,
  store: StoreRow,
  connector: StoreConnector,
  o: StoreOrder,
  now: number,
): Promise<Imported | null> {
  const [known] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.storeId, store.id), eq(orders.externalId, o.externalId)))
  if (known) return null
  const lines: {
    variantId: string
    qty: number
    unitPricePoisha: number
    lineTotalPoisha: number
  }[] = []
  for (const l of o.lines) {
    const variantId = await variantFor(db, store, connector, l, now)
    if (!variantId) {
      log.warn(
        { storeId: store.id, order: o.number, variant: l.variantExternalId },
        'store order has an unknown item, skipped',
      )
      return null
    }
    lines.push({
      variantId,
      qty: l.qty,
      unitPricePoisha: l.unitPricePoisha,
      lineTotalPoisha: l.unitPricePoisha * l.qty,
    })
  }
  const customerId = await customerFor(db, store.shopId, o.customer, now)
  const paid = Math.min(o.paidPoisha, o.totalPoisha)
  const orderId = newId()
  // The store's total is the truth (it may include discounts); our subtotal follows from it.
  const subtotal = o.totalPoisha - o.shippingPoisha
  const number = await write(db, async (tx) => {
    const [seq] = await tx
      .update(shops)
      .set({ orderSeq: sql`${shops.orderSeq} + 1` })
      .where(eq(shops.id, store.shopId))
      .returning({ n: shops.orderSeq })
    await tx.insert(orders).values({
      id: orderId,
      shopId: store.shopId,
      number: seq!.n,
      customerId,
      conversationId: null,
      status: o.status,
      paymentMethod: o.paymentMethod ?? 'cod',
      paymentStatus: paid === 0 ? 'unpaid' : paid >= o.totalPoisha ? 'paid' : 'partial',
      deliveryArea: o.customer.area ?? '',
      deliveryAddress: o.customer.address ?? null,
      deliveryPoisha: o.shippingPoisha,
      subtotalPoisha: subtotal,
      totalPoisha: o.totalPoisha,
      paidPoisha: paid,
      note: null,
      source: 'store',
      storeId: store.id,
      externalId: o.externalId,
      externalNumber: o.number,
      adminUrl: o.adminUrl ?? null,
      createdAt: o.createdAt,
      updatedAt: now,
    })
    await tx.insert(orderLines).values(lines.map((l) => ({ id: newId(), orderId, ...l })))
    if (paid > 0) {
      await tx.insert(payments).values({
        id: newId(),
        orderId,
        amountPoisha: paid,
        method: o.paymentMethod ?? 'store',
        createdAt: o.createdAt,
      })
    }
    return seq!.n
  })
  log.info({ storeId: store.id, number, external: o.number }, 'store order imported')
  return { orderId, number, externalNumber: o.number, totalPoisha: o.totalPoisha }
}

const ordersWindow = 30 * 24 * 60 * 60 * 1000

async function pullOrders(db: Db, store: StoreRow, connector: StoreConnector, now: number) {
  let cursor: string | undefined
  let imported = 0
  do {
    const page = await connector.listOrders(now - ordersWindow, cursor)
    for (const o of page.orders) {
      const done = await importOrder(db, store, connector, o, now)
      if (done) imported++
      else
        await applyEvent(
          db,
          store,
          connector,
          {
            type: 'order.upsert',
            externalId: o.externalId,
            status: o.status,
            paidPoisha: o.paidPoisha,
          },
          now,
        )
    }
    cursor = page.next
  } while (cursor)
  return imported
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
    // Order access is often a separate permission (Shopify protected customer data); products still count.
    let imported = 0
    let ordersError: string | null = null
    try {
      imported = await pullOrders(db, store, connector, now)
    } catch (err) {
      ordersError = `orders not synced: ${err instanceof Error ? err.message : String(err)}`.slice(
        0,
        500,
      )
      log.warn({ storeId: store.id, err: ordersError }, 'store orders not synced')
    }
    await db
      .update(stores)
      .set({ status: 'connected', lastSyncAt: now, lastError: ordersError })
      .where(eq(stores.id, store.id))
    log.info({ storeId: store.id, products: seen.length, imported }, 'store synced')
    return { products: seen.length, ordersImported: imported }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(stores)
      .set({ status: 'error', lastError: message.slice(0, 500) })
      .where(eq(stores.id, store.id))
    throw err
  }
}
