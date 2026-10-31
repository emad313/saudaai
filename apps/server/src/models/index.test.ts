import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../env.ts'
import { testShop } from '../test/shop.ts'
import { createModels } from './index.ts'

const meta = {
  ...env,
  AGENT_PROVIDER: 'meta' as const,
  BASETEN_API_KEY: undefined,
  META_API_KEY: 'k',
  META_API_BASE_URL: 'https://meta.test/v1',
  META_AGENT_MODEL: 'muse-spark-1.3',
  META_VISION_MODEL: undefined,
  META_TRANSCRIBE_MODEL: undefined,
}

let sent: { url: string; body: { model?: string } }[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    const content = '{"category":"kurti","nameSuggestion":"Maroon Kurti"}'
    return Response.json({ choices: [{ message: { content } }] })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('createModels', () => {
  it('plans with the meta agent model by default', async () => {
    const { db } = await testShop()
    await createModels(db, meta).plan([{ role: 'user', content: 'hi' }], [])
    expect(sent).toEqual([
      expect.objectContaining({
        url: 'https://meta.test/v1/chat/completions',
        body: expect.objectContaining({ model: 'muse-spark-1.3' }),
      }),
    ])
  })

  it('falls back to the meta agent model for vision, never baseten', async () => {
    const { db } = await testShop()
    const out = await createModels(db, meta).describe(Buffer.from('photo'), '')
    expect(out.category).toBe('kurti')
    expect(sent[0]!.url).toBe('https://meta.test/v1/chat/completions')
    expect(sent[0]!.body.model).toBe('muse-spark-1.3')
  })

  it('uses baseten only when asked for explicitly', async () => {
    const { db } = await testShop()
    const models = createModels(db, { ...meta, AGENT_PROVIDER: 'baseten' })
    await expect(models.plan([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(
      'BASETEN_API_KEY is not set',
    )
    expect(sent).toEqual([])
  })
})
