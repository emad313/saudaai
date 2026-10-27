import { Bot } from 'grammy'
import { env } from '../src/env.ts'

const base = env.PUBLIC_BASE_URL.replace(/\/$/, '')
if (!base.startsWith('https://')) {
  console.log(`PUBLIC_BASE_URL must be a public https url, got ${base}`)
  process.exit(1)
}

if (env.TELEGRAM_BOT_TOKEN) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN)
  await bot.api.setWebhook(`${base}/tg/webhook`, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  })
  const info = await bot.api.getWebhookInfo()
  console.log(`telegram webhook: ${info.url} (pending ${info.pending_update_count})`)
  console.log('set TELEGRAM_MODE=webhook on the server')
} else {
  console.log('TELEGRAM_BOT_TOKEN not set, skipping telegram')
}

console.log(`
Meta app > Webhooks (Messenger and WhatsApp):
  Callback URL:  ${base}/webhooks/meta
  Verify token:  the value of META_VERIFY_TOKEN
  Messenger fields: messages, messaging_postbacks
  WhatsApp fields:  messages`)
