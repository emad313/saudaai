import { serve } from '@hono/node-server'
import { env } from './env.ts'
import { createApp } from './http/app.ts'
import { log } from './log.ts'

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  log.info({ port: info.port }, 'server listening')
})
