import { z } from 'zod'

const taka = z.number().int().min(0).max(10_000_000)

export const authCode = z.object({ code: z.string().regex(/^\d{6}$/) })

export const orderPatch = z.object({
  status: z.enum(['confirmed', 'shipped', 'delivered', 'cancelled']),
})

export const paymentInput = z.object({ amountTaka: taka.min(1), method: z.string().min(1) })

export const productPatch = z.object({
  name: z.string().min(2).optional(),
  priceTaka: taka.min(1).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
})

export const variantAdjust = z.object({
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'delta cannot be 0'),
  reason: z.string().min(1),
})

export const pendingDecision = z.object({
  action: z.enum(['approve', 'cancel']),
  text: z.string().min(1).optional(),
})

export const sellerMessage = z.object({ text: z.string().min(1).max(2000) })

export const shopPatch = z.object({
  name: z.string().min(2).optional(),
  area: z.string().min(2).optional(),
  bkashNumber: z.string().nullable().optional(),
  paymentMethods: z
    .array(z.enum(['cod', 'bkash', 'nagad']))
    .min(1)
    .optional(),
  insideDhakaTaka: taka.optional(),
  outsideDhakaTaka: taka.optional(),
  autoConfirmUpToTaka: taka.nullable().optional(),
  autoSendConfirmation: z.boolean().optional(),
  autoSendReminders: z.boolean().optional(),
  feedMuted: z.boolean().optional(),
})

export const chatMessage = z.object({ text: z.string().min(1).max(1000) })

export const orderForm = z.object({
  items: z
    .array(z.object({ variantId: z.string().min(1), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(10),
  name: z.string().min(1).max(80),
  phone: z.string().min(8).max(20),
  address: z.string().min(3).max(300),
  area: z.string().min(2).max(80),
  paymentMethod: z.string().min(1),
  note: z.string().max(300).optional(),
})

export type ShopPatch = z.infer<typeof shopPatch>
export type OrderForm = z.infer<typeof orderForm>
