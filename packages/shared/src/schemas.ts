import { z } from 'zod'
import { currencies } from './money.ts'

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
  ownerName: z.string().min(1).max(60).optional(),
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
  currency: z.enum(currencies).optional(),
})

export const chatMessage = z.object({ text: z.string().min(1).max(1000) })

export const widgetMessage = chatMessage.extend({
  pageUrl: z.url().max(500).optional(),
  productId: z.string().max(100).optional(),
})

export type ShopPatch = z.infer<typeof shopPatch>

export const storeConnect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({
    kind: z.literal('custom'),
    baseUrl: z.url(),
    token: z.string().min(8),
  }),
  z.object({
    kind: z.literal('shopify'),
    shopDomain: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'like your-shop.myshopify.com'),
    accessToken: z.string().min(10),
    apiSecret: z.string().min(10),
  }),
  z.object({
    kind: z.literal('woocommerce'),
    baseUrl: z.url({ protocol: /^https$/ }),
    consumerKey: z.string().startsWith('ck_'),
    consumerSecret: z.string().startsWith('cs_'),
  }),
])
