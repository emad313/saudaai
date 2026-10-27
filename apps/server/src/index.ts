import { serve } from '@hono/node-server'
import { env } from './env.ts'
import { createApp } from './http/app.ts'
import { startJobs } from './jobs/index.ts'
import { log } from './log.ts'
import { closeBrowser } from './render/browser.ts'
import { createServices } from './services.ts'

const services = await createServices()
const server = serve({ fetch: createApp(services).fetch, port: env.PORT }, (info) => {
  log.info({ port: info.port }, 'server listening')
})
const stopJobs = startJobs(services.deps)

const bot = services.telegram.bot
if (bot && env.TELEGRAM_MODE === 'polling') {
  void bot.start({ onStart: (me) => log.info({ bot: me.username }, 'telegram polling') })
}

async function shutdown() {
  stopJobs()
  if (bot && env.TELEGRAM_MODE === 'polling') await bot.stop()
  await closeBrowser()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
