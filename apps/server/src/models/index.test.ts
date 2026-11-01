import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { env } from '../env.ts'
import { newId } from '../db/ids.ts'
import { modelCalls } from '../db/schema.ts'
import { testShop } from '../test/shop.ts'
import { createModels } from './index.ts'
import { ModelLimitError } from './track.ts'

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

describe('image', () => {
  it('sends reference images to the edits endpoint, plain prompts to generations', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) })
      return Response.json({ data: [{ b64_json: Buffer.from('img').toString('base64') }] })
    })
    const { db } = await testShop()
    const models = createModels(db, { ...meta, META_IMAGE_MODEL: 'muse-image-1.0' })
    const ref = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()

    await models.image('a poster', '1024x1024')
    await models.image('like this', '1024x1024', [ref])

    expect(sent.map((s) => s.url)).toEqual([
      'https://meta.test/v1/images/generations',
      'https://meta.test/v1/images/edits',
    ])
    const images = (sent[1]!.body as { images: { image_url: string }[] }).images
    expect(images).toHaveLength(1)
    expect(images[0]!.image_url).toMatch(/^data:image\/jpeg;base64,/)
  })
})

describe('daily call limit', () => {
  it('blocks real calls past the limit and flags only the first refusal', async () => {
    const { db } = await testShop()
    const row = {
      provider: 'meta',
      model: 'm',
      purpose: 'plan',
      latencyMs: 1,
      createdAt: Date.now(),
    }
    await db.insert(modelCalls).values([
      { ...row, id: newId(), cacheHit: false },
      { ...row, id: newId(), cacheHit: true },
    ])
    const models = createModels(db, { ...meta, MODEL_DAILY_CALL_LIMIT: 2 })
    const ask = () => models.plan([{ role: 'user', content: 'hi' }], [])

    await ask()
    const first = await ask().catch((e: unknown) => e)
    const second = await ask().catch((e: unknown) => e)
    expect(first).toBeInstanceOf(ModelLimitError)
    expect((first as ModelLimitError).first).toBe(true)
    expect((second as ModelLimitError).first).toBe(false)
    expect(sent).toHaveLength(1)
  })
})
