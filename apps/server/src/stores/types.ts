import type { StoreKind } from '../db/schema.ts'

export type ExternalVariant = {
  externalId: string
  size?: string
  color?: string
  sku?: string
  pricePoisha: number
  stock: number | null
}

export type ExternalProduct = {
  externalId: string
  name: string
  category?: string
  description?: string
  imageUrl?: string
  status: 'active' | 'draft' | 'archived'
  variants: ExternalVariant[]
}

export type Upload = { bytes: Buffer; mime: string; name: string }

export type ExternalOrderInput = {
  customer: { name: string; phone?: string; email?: string; address?: string; area?: string }
  lines: { variantExternalId: string; qty: number }[]
  shippingPoisha: number
  paymentMethod: string
  note?: string
  tags: string[]
}

export type ExternalOrder = {
  externalId: string
  number: string
  adminUrl?: string
  totalPoisha: number
}

// A full order as the store has it, for orders customers placed on the site itself.
export type StoreOrder = {
  externalId: string
  number: string
  status: 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  createdAt: number
  customer: { name: string; phone?: string; email?: string; address?: string; area?: string }
  lines: {
    variantExternalId: string
    productExternalId?: string
    qty: number
    unitPricePoisha: number
  }[]
  shippingPoisha: number
  totalPoisha: number
  paidPoisha: number
  paymentMethod?: string
  adminUrl?: string
}

export type OrderChange = {
  status?: 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  paidPoisha?: number
  note?: string
}

export type StoreEvent =
  | { type: 'product.upsert'; product: ExternalProduct }
  | { type: 'product.delete'; externalId: string }
  | { type: 'stock'; variantExternalId: string; stock: number }
  | { type: 'order.upsert'; externalId: string; status: string; paidPoisha?: number }

export type TestResult = { ok: true; name: string; currency: string } | { ok: false; error: string }

export interface StoreConnector {
  kind: Exclude<StoreKind, 'builtin'>
  test(): Promise<TestResult>
  listProducts(cursor?: string): Promise<{ products: ExternalProduct[]; next?: string }>
  getProduct(externalId: string): Promise<ExternalProduct | null>
  createOrder(input: ExternalOrderInput): Promise<ExternalOrder>
  updateOrder(externalId: string, change: OrderChange): Promise<void>
  getOrder(externalId: string): Promise<StoreOrder | null>
  listOrders(since: number, cursor?: string): Promise<{ orders: StoreOrder[]; next?: string }>
  adjustStock?(variantExternalId: string, delta: number): Promise<number>
  // image carries the bytes for stores that take an upload; imageUrl is the fallback they fetch.
  createProduct?(
    p: Omit<ExternalProduct, 'externalId'> & { image?: Upload },
  ): Promise<ExternalProduct>
  publishProduct?(externalId: string): Promise<void>
  // Returns the topics the store refused, with its reason; the others are subscribed.
  registerWebhooks?(url: string): Promise<{ topic: string; reason: string }[]>
  // Where the customer can pay what is still due online; null when the store has no such link.
  paymentLink?(externalId: string): Promise<string | null>
  publishPost?(post: {
    title: string
    body: string
    imageUrl: string
    image?: Upload
  }): Promise<{ url: string }>
  parseWebhook(req: { headers: Record<string, string>; raw: string }): Promise<StoreEvent[]>
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}
