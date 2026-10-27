export type Me = {
  id: string
  slug: string
  name: string
  area: string
  ownerName: string
  deliveryRules: { insideDhakaPoisha: number; outsideDhakaPoisha: number; insideAreas: string[] }
  paymentMethods: string[]
  bkashNumber: string | null
  auto: {
    confirm_order?: { maxPoisha: number }
    send_order_confirmation?: boolean
    send_payment_reminder?: boolean
  }
  feedMuted: boolean
  telegramLinked: boolean
  linkCode: string | null
  readonly: boolean
}

export type OrderRow = {
  orderId: string
  number: number
  customer: string
  status: string
  paymentStatus: string
  paymentMethod: string
  total: string
  totalPoisha: number
  duePoisha: number
  createdAt: number
}

export type OrderDetail = {
  orderId: string
  number: number
  status: string
  paymentStatus: string
  paymentMethod: string
  customer: { customerId?: string; name?: string; phone?: string | null }
  deliveryArea: string
  deliveryAddress: string | null
  lines: {
    product: string
    size: string | null
    color: string | null
    qty: number
    unitPrice: string
    lineTotal: string
  }[]
  subtotal: string
  delivery: string
  total: string
  paid: string
  due: string
  duePoisha: number
  createdAt: number
}

export type Pending = {
  id: string
  tool: string
  preview: string
  status: string
  args: Record<string, unknown>
  createdAt: number
  expiresAt: number
  decidedAt: number | null
}

export type Summary = {
  today: {
    orders: number
    revenue: string
    collected: string
    expenses: string
    topProducts: { name: string; qty: number }[]
  }
  lowStock: { item: string; available: number }[]
  dues: { orders: number; due: string }
  draftOrders: number
}

export type Activity = {
  id: string
  turnId: string
  actor: string
  step: number
  tool: string
  args: unknown
  result: unknown
  decision: 'run' | 'pending' | 'reject' | 'invalid' | 'error'
  latencyMs: number
  createdAt: number
}

export type ConversationRow = {
  id: string
  channel: 'messenger' | 'whatsapp' | 'webchat'
  name: string
  customerId: string | null
  pausedUntil: number | null
  last: string | null
  lastAt: number
}

export type Message = {
  id: string
  role: 'seller' | 'customer' | 'agent' | 'system'
  kind: string
  text: string | null
  transcript: string | null
  mediaUrl: string | null
  createdAt: number
}

export type ProductRow = {
  id: string
  name: string
  category: string
  status: 'draft' | 'active' | 'archived'
  pricePoisha: number
  imageUrl: string | null
  variants: {
    id: string
    size: string | null
    color: string | null
    pricePoisha: number
    stock: number
    reserved: number
  }[]
}
