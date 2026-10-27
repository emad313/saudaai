import { z } from 'zod'

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8787'),
  DATABASE_URL: z.string().default('file:./data/saudaai.db'),
  MEDIA_DIR: z.string().default('./data/media'),
  SESSION_SECRET: z.string().default('dev-secret'),
  DEMO_READONLY: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  DEMO_SHOP_SLUG: z.string().default('nusrats-closet'),

  AGENT_PROVIDER: z.enum(['baseten', 'meta']).default('baseten'),
  BASETEN_API_KEY: optional,
  BASETEN_BASE_URL: z.string().default('https://inference.baseten.co/v1'),
  BASETEN_MODEL: z.string().default('meta-models/muse-spark-open-1026'),

  META_API_KEY: optional,
  META_API_BASE_URL: optional,
  META_AGENT_MODEL: optional,
  META_VISION_MODEL: optional,
  META_TRANSCRIBE_MODEL: optional,
  META_SAM_MODEL: optional,
  META_IMAGE_MODEL: optional,

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,

  GRAPH_API_VERSION: z.string().default('v23.0'),
  META_APP_SECRET: optional,
  META_VERIFY_TOKEN: optional,
  MESSENGER_PAGE_ID: optional,
  MESSENGER_PAGE_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_TOKEN: optional,
  WHATSAPP_REMINDER_TEMPLATE: z.string().default('payment_reminder'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('bn'),
})

export type Env = z.infer<typeof schema>

export const env = schema.parse(process.env)
