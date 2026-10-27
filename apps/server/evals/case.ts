import { z } from 'zod'

const variantKey = z.string().regex(/^.+\/.+$/, 'use "Product name/size or color"')

export const evalCase = z.object({
  id: z.string(),
  category: z.string().optional(),
  actor: z.enum(['seller', 'customer']),
  channel: z.enum(['webchat', 'messenger', 'whatsapp']).default('webchat'),
  inputKind: z.enum(['text', 'voice', 'photo']).default('text'),
  input: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(['customer', 'agent', 'seller']), text: z.string() }))
    .default([]),
  setup: z
    .object({
      photo: z.boolean().optional(),
      photoFor: z.string().optional(),
      customer: z.string().optional(),
      auto: z.record(z.string(), z.unknown()).optional(),
      staleChat: z
        .object({
          customer: z.string(),
          channel: z.enum(['messenger', 'whatsapp']),
          hoursAgo: z.number(),
        })
        .optional(),
    })
    .default({}),
  expect: z
    .object({
      order: z
        .object({
          items: z.array(z.string().regex(/^.+\/.+ x\d+$/)),
          paymentMethod: z.string().optional(),
          customer: z.string().optional(),
          status: z.string().optional(),
          source: z.string().optional(),
          deliveryTaka: z.number().optional(),
        })
        .optional(),
      noOrder: z.boolean().optional(),
      pending: z.array(z.string()).optional(),
      noPending: z.boolean().optional(),
      pendingArgs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      orderStatus: z.record(z.string(), z.string()).optional(),
      orderPaid: z.record(z.string(), z.number()).optional(),
      stock: z.record(variantKey, z.number()).optional(),
      product: z
        .object({
          priceTaka: z.number(),
          variants: z.number(),
          stockEach: z.number().optional(),
          withPhoto: z.boolean().optional(),
        })
        .optional(),
      noProduct: z.boolean().optional(),
      expense: z.number().optional(),
      asks: z.boolean().optional(),
      replyMentionsAvailable: variantKey.optional(),
      reply: z
        .object({
          containsAny: z.array(z.string()).optional(),
          notContainsAny: z.array(z.string()).optional(),
        })
        .optional(),
      held: z.boolean().optional(),
      calls: z.array(z.string()).optional(),
      sentImages: z.number().optional(),
      sentMessages: z.number().optional(),
      noOffer: z.boolean().optional(),
    })
    .refine((e) => Object.keys(e).length > 0, 'a case needs at least one expectation'),
})

export type EvalCase = z.infer<typeof evalCase> & { category: string }
