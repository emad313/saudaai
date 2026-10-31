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
