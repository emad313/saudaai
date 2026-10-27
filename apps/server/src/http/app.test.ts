import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'

describe('app', () => {
  const app = createApp()

  it('answers health checks', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns the error shape for unknown routes', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } })
  })
})
