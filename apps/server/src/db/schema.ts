import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const id = () => text('id').primaryKey()
const createdAt = () => integer('created_at').notNull()

export type DeliveryRules = {
  insideDhakaPoisha: number
  outsideDhakaPoisha: number
  insideAreas: string[]
}

export type AutoRules = {
  confirm_order?: { maxPoisha: number }
  send_order_confirmation?: boolean
  send_payment_reminder?: boolean
}

export const shops = sqliteTable('shops', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ownerName: text('owner_name').notNull(),
  area: text('area').notNull(),
  language: text('language').notNull().default('bn'),
  deliveryRules: text('delivery_rules', { mode: 'json' }).$type<DeliveryRules>().notNull(),
  paymentMethods: text('payment_methods', { mode: 'json' }).$type<string[]>().notNull(),
  bkashNumber: text('bkash_number'),
  auto: text('auto', { mode: 'json' }).$type<AutoRules>().notNull().default({}),
  feedMuted: integer('feed_muted', { mode: 'boolean' }).notNull().default(false),
  telegramChatId: text('telegram_chat_id'),
  linkCode: text('link_code').notNull(),
  orderSeq: integer('order_seq').notNull().default(1000),
  createdAt: createdAt(),
})

export const media = sqliteTable('media', {
  id: id(),
  sha256: text('sha256').notNull().unique(),
  mime: text('mime').notNull(),
  path: text('path').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  role: text('role', { enum: ['upload', 'catalog', 'cutout', 'invoice', 'ad'] })
    .notNull()
    .default('upload'),
  derivedFrom: text('derived_from'),
  createdAt: createdAt(),
})

export const products = sqliteTable(
  'products',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    name: text('name').notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    category: text('category').notNull(),
    attributes: text('attributes', { mode: 'json' })
      .$type<Record<string, string | string[]>>()
      .notNull()
      .default({}),
    basePricePoisha: integer('base_price_poisha').notNull(),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull(),
    imageId: text('image_id').references(() => media.id),
    createdAt: createdAt(),
  },
  (t) => [index('products_shop_idx').on(t.shopId, t.status)],
)

export const variants = sqliteTable(
  'variants',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    size: text('size'),
    color: text('color'),
    pricePoisha: integer('price_poisha').notNull(),
    stock: integer('stock').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
  },
  (t) => [
    index('variants_product_idx').on(t.productId),
    check(
      'variants_stock_check',
      sql`${t.stock} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.stock}`,
    ),
  ],
)

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    area: text('area'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customers_phone_idx').on(t.shopId, t.phone)],
)

export const orderStatuses = ['draft', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export const paymentStatuses = ['unpaid', 'partial', 'paid'] as const
export const orderSources = ['seller_voice', 'seller_text', 'customer_chat'] as const

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    number: integer('number').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    conversationId: text('conversation_id'),
    status: text('status', { enum: orderStatuses }).notNull(),
    paymentMethod: text('payment_method').notNull(),
    paymentStatus: text('payment_status', { enum: paymentStatuses }).notNull(),
    deliveryArea: text('delivery_area').notNull(),
    deliveryAddress: text('delivery_address'),
    deliveryPoisha: integer('delivery_poisha').notNull(),
    subtotalPoisha: integer('subtotal_poisha').notNull(),
    totalPoisha: integer('total_poisha').notNull(),
    paidPoisha: integer('paid_poisha').notNull().default(0),
    note: text('note'),
    source: text('source', { enum: orderSources }).notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('orders_number_idx').on(t.shopId, t.number),
    index('orders_status_idx').on(t.shopId, t.status, t.createdAt),
  ],
)

export const orderLines = sqliteTable(
  'order_lines',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id),
    qty: integer('qty').notNull(),
    unitPricePoisha: integer('unit_price_poisha').notNull(),
    lineTotalPoisha: integer('line_total_poisha').notNull(),
  },
  (t) => [
    index('order_lines_order_idx').on(t.orderId),
    check('order_lines_qty_check', sql`${t.qty} > 0`),
  ],
)

export const payments = sqliteTable('payments', {
  id: id(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  amountPoisha: integer('amount_poisha').notNull(),
  method: text('method').notNull(),
  createdAt: createdAt(),
})

export const expenses = sqliteTable('expenses', {
  id: id(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  amountPoisha: integer('amount_poisha').notNull(),
  category: text('category').notNull(),
  note: text('note'),
  createdAt: createdAt(),
})

export const channels = ['telegram_seller', 'messenger', 'whatsapp', 'webchat'] as const
export type Channel = (typeof channels)[number]

export const conversations = sqliteTable(
  'conversations',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    channel: text('channel', { enum: channels }).notNull(),
    externalUserId: text('external_user_id').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    profileName: text('profile_name'),
    lastInboundAt: integer('last_inbound_at').notNull(),
    pausedUntil: integer('paused_until'),
    failures: integer('failures').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('conversations_user_idx').on(t.shopId, t.channel, t.externalUserId)],
)

export const customerIdentities = sqliteTable(
  'customer_identities',
  {
    id: id(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    channel: text('channel', { enum: channels }).notNull(),
    externalUserId: text('external_user_id').notNull(),
    profileName: text('profile_name'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('identities_user_idx').on(t.channel, t.externalUserId)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    externalMessageId: text('external_message_id'),
    role: text('role', { enum: ['seller', 'customer', 'agent', 'system'] }).notNull(),
    kind: text('kind', { enum: ['text', 'voice', 'photo', 'invoice', 'ad', 'location'] }).notNull(),
    text: text('text'),
    transcript: text('transcript'),
    mediaId: text('media_id').references(() => media.id),
    deliveryStatus: text('delivery_status', { enum: ['sent', 'delivered', 'read', 'failed'] }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_external_idx').on(t.conversationId, t.externalMessageId),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  ],
)

export const pendingStatuses = [
  'pending',
  'approved',
  'edited',
  'cancelled',
  'expired',
  'failed',
] as const

export const pendingActions = sqliteTable(
  'pending_actions',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    conversationId: text('conversation_id'),
    tool: text('tool').notNull(),
    args: text('args', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    preview: text('preview').notNull(),
    status: text('status', { enum: pendingStatuses }).notNull(),
    result: text('result', { mode: 'json' }),
    telegramMessageId: text('telegram_message_id'),
    expiresAt: integer('expires_at').notNull(),
    decidedAt: integer('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [index('pending_shop_idx').on(t.shopId, t.status)],
)

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: id(),
    shopId: text('shop_id').notNull(),
    turnId: text('turn_id').notNull(),
    actor: text('actor', { enum: ['seller', 'customer', 'system'] }).notNull(),
    step: integer('step').notNull(),
    tool: text('tool').notNull(),
    args: text('args', { mode: 'json' }),
    result: text('result', { mode: 'json' }),
    decision: text('decision', {
      enum: ['run', 'pending', 'reject', 'invalid', 'error'],
    }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_shop_idx').on(t.shopId, t.createdAt),
    index('activity_turn_idx').on(t.turnId),
  ],
)

export const modelCalls = sqliteTable('model_calls', {
  id: id(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(),
  cacheKey: text('cache_key'),
  cacheHit: integer('cache_hit', { mode: 'boolean' }).notNull(),
  latencyMs: integer('latency_ms').notNull(),
  inputUnits: integer('input_units'),
  outputUnits: integer('output_units'),
  error: text('error'),
  createdAt: createdAt(),
})

export const modelCache = sqliteTable('model_cache', {
  key: text('key').primaryKey(),
  purpose: text('purpose').notNull(),
  value: text('value', { mode: 'json' }).notNull(),
  createdAt: createdAt(),
})

export const sessions = sqliteTable('sessions', {
  id: id(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  expiresAt: integer('expires_at').notNull(),
  createdAt: createdAt(),
})

export const loginCodes = sqliteTable('login_codes', {
  code: text('code').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  expiresAt: integer('expires_at').notNull(),
})
