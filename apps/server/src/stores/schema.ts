import { z } from 'zod'

const poisha = z.number().int().min(0)

export const externalProduct = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  status: z.enum(['active', 'draft', 'archived']),
  variants: z.array(
    z.object({
      externalId: z.string().min(1),
      size: z.string().optional(),
      color: z.string().optional(),
      sku: z.string().optional(),
      pricePoisha: poisha,
      stock: z.number().int().nullable(),
    }),
  ),
})

export const storeEvents = z.array(
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('product.upsert'), product: externalProduct }),
    z.object({ type: z.literal('product.delete'), externalId: z.string().min(1) }),
    z.object({
      type: z.literal('stock'),
      variantExternalId: z.string().min(1),
      stock: z.number().int(),
    }),
    z.object({
      type: z.literal('order.upsert'),
      externalId: z.string().min(1),
      status: z.string(),
      paidPoisha: poisha.optional(),
    }),
  ]),
)

export const storeOrder = z.object({
  externalId: z.string().min(1),
  number: z.coerce.string(),
  status: z.enum(['confirmed', 'shipped', 'delivered', 'cancelled']),
  createdAt: z.number().int(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    area: z.string().optional(),
  }),
  lines: z
    .array(
      z.object({
        variantExternalId: z.string().min(1),
        productExternalId: z.string().optional(),
        qty: z.number().int().positive(),
        unitPricePoisha: poisha,
      }),
    )
    .min(1),
  shippingPoisha: poisha,
  totalPoisha: poisha,
  paidPoisha: poisha,
  paymentMethod: z.string().optional(),
  adminUrl: z.string().optional(),
})
