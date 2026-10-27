import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { authCode } from '@saudaai/shared'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { env } from '../env.ts'
import { log } from '../log.ts'
import { loadMedia } from '../media/store.ts'
import type { Services } from '../services.ts'
import { ToolError } from '../tools/ctx.ts'
import { body } from './body.ts'
import { sellerRoutes } from './seller.ts'
import { login, logout, requireShop, type SellerEnv } from './session.ts'
import { shopRoutes } from './shop.ts'
import { webhookRoutes } from './webhooks.ts'

export function createApp(services?: Services) {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  if (services) {
    const { db, deps, inbox } = services
    app.route('/', webhookRoutes(services))

    app.post('/api/auth/code', async (c) => {
      const { code } = await body(c, authCode)
      await login(c, db, code)
      return c.json({ ok: true })
    })
    app.post('/api/auth/logout', async (c) => {
      await logout(c, db)
      return c.json({ ok: true })
    })

    app.route('/api/s', shopRoutes(deps, inbox))
    const seller = new Hono<SellerEnv>()
    seller.use('*', requireShop(db))
    seller.route('/', sellerRoutes(deps))
    app.route('/api', seller)

    app.get('/media/:id', async (c) => {
      const file = await loadMedia(db, c.req.param('id'))
      if (!file) return c.json({ error: { code: 'not_found', message: 'media not found' } }, 404)
      return c.body(new Uint8Array(file.bytes), 200, {
        'content-type': file.row.mime,
        'cache-control': 'private, max-age=31536000, immutable',
      })
    })

    if (env.NODE_ENV === 'production') {
      const root = resolve(env.WEB_DIST)
      app.use('/assets/*', serveStatic({ root }))
      app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api/')) return next()
        return c.html(await readFile(resolve(root, 'index.html'), 'utf8'))
      })
    }
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status)
    }
    if (err instanceof ToolError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.code === 'not_found' ? 404 : 400,
      )
    }
    log.error({ err, path: c.req.path }, 'unhandled error')
    return c.json({ error: { code: 'internal', message: 'something went wrong' } }, 500)
  })

  return app
}
