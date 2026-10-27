import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { log } from '../log.ts'

export function createApp() {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status)
    }
    log.error({ err, path: c.req.path }, 'unhandled error')
    return c.json({ error: { code: 'internal', message: 'something went wrong' } }, 500)
  })

  return app
}
