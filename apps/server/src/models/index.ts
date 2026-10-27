import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Db } from '../db/client.ts'
import type { Env } from '../env.ts'
import { complete, parseJsonReply, type ChatMessage, type Endpoint, type ToolSpec } from './chat.ts'
import { ModelError, postJson, request } from './http.ts'
import { hashOf, tracked } from './track.ts'

const run = promisify(execFile)

export type PlanResult = Awaited<ReturnType<typeof complete>>

export const productAttributes = z.object({
  category: z.string(),
  colors: z.array(z.string()).default([]),
  pattern: z.string().optional(),
  material: z.string().optional(),
  nameSuggestion: z.string(),
  aliases: z.array(z.string()).default([]),
})
export type ProductAttributes = z.infer<typeof productAttributes>

export type Models = {
  plan(messages: ChatMessage[], tools: ToolSpec[]): Promise<PlanResult>
  transcribe(audio: Buffer, mime: string): Promise<string>
  segment(image: Buffer, prompt: string): Promise<Buffer | null>
  describe(image: Buffer, hint: string): Promise<ProductAttributes>
  image(prompt: string, size: '1024x1024' | '1024x1792'): Promise<Buffer>
  readonly agentProvider: string
}

function need(value: string | undefined, name: string): string {
  if (!value) throw new ModelError(`${name} is not set`)
  return value
}

async function toWav(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'audio-'))
  try {
    await writeFile(join(dir, 'in'), audio)
    await run('ffmpeg', [
      '-y',
      '-i',
      join(dir, 'in'),
      '-ac',
      '1',
      '-ar',
      '16000',
      join(dir, 'out.wav'),
    ])
    return await readFile(join(dir, 'out.wav'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function createModels(db: Db, env: Env): Models {
  const baseten = (): Endpoint => ({
    provider: 'baseten',
    baseUrl: env.BASETEN_BASE_URL,
    key: need(env.BASETEN_API_KEY, 'BASETEN_API_KEY'),
    model: env.BASETEN_MODEL,
  })
  const meta = (model: string | undefined, name: string): Endpoint => ({
    provider: 'meta',
    baseUrl: need(env.META_API_BASE_URL, 'META_API_BASE_URL'),
    key: need(env.META_API_KEY, 'META_API_KEY'),
    model: need(model, name),
  })
  const agent = () =>
    env.AGENT_PROVIDER === 'meta' ? meta(env.META_AGENT_MODEL, 'META_AGENT_MODEL') : baseten()
  const vision = () =>
    env.META_VISION_MODEL ? meta(env.META_VISION_MODEL, 'META_VISION_MODEL') : baseten()

  return {
    agentProvider: env.AGENT_PROVIDER,

    async plan(messages, tools) {
      const ep = agent()
      return tracked(db, {
        purpose: 'plan',
        provider: ep.provider,
        model: ep.model,
        run: async () => {
          const out = await complete(ep, { messages, tools }, 30_000)
          return { value: out, inputUnits: out.inputUnits, outputUnits: out.outputUnits }
        },
      })
    },

    async transcribe(audio, mime) {
      if (env.META_TRANSCRIBE_MODEL) {
        const ep = meta(env.META_TRANSCRIBE_MODEL, 'META_TRANSCRIBE_MODEL')
        return tracked(db, {
          purpose: 'transcribe',
          provider: ep.provider,
          model: ep.model,
          cacheKey: hashOf('transcribe', ep.model, audio),
          run: async () => {
            const form = new FormData()
            form.append('model', ep.model)
            form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), 'voice.ogg')
            const res = await request(`${ep.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
              headers: { authorization: `Bearer ${ep.key}` },
              body: form,
              timeoutMs: 30_000,
            })
            const body = (await res.json()) as { text?: string }
            return { value: (body.text ?? '').trim() }
          },
        })
      }
      const ep = baseten()
      return tracked(db, {
        purpose: 'transcribe',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('transcribe', ep.model, audio),
        run: async () => {
          const wav = await toWav(audio)
          const out = await complete(
            ep,
            {
              messages: [
                {
                  role: 'system',
                  content:
                    'Transcribe the voice note exactly as spoken. It is usually Bangla mixed with English words. Write Bangla in Bangla script and English words in Latin script. Output only the transcript.',
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_audio',
                      input_audio: { data: wav.toString('base64'), format: 'wav' },
                    },
                  ],
                },
              ],
              temperature: 0,
            },
            30_000,
          )
          return { value: out.text, inputUnits: out.inputUnits, outputUnits: out.outputUnits }
        },
      })
    },

    async segment(image, prompt) {
      if (!env.META_SAM_MODEL) return null
      const ep = meta(env.META_SAM_MODEL, 'META_SAM_MODEL')
      const mask = await tracked<string | null>(db, {
        purpose: 'segment',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('segment', ep.model, prompt, image),
        run: async () => {
          const body = await postJson<{ masks?: { mask?: string; score?: number }[] }>(
            `${ep.baseUrl.replace(/\/$/, '')}/images/segmentations`,
            ep.key,
            { model: ep.model, image: image.toString('base64'), prompt: { text: prompt } },
            20_000,
          )
          const best = [...(body.masks ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
          return { value: best?.mask ?? null }
        },
      })
      return mask ? Buffer.from(mask, 'base64') : null
    },

    async describe(image, hint) {
      const ep = vision()
      const raw = await tracked<unknown>(db, {
        purpose: 'describe',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('describe', ep.model, hint, image),
        run: async () => {
          const out = await complete(
            ep,
            {
              messages: [
                {
                  role: 'system',
                  content:
                    'You catalog products for a small clothing and accessories shop in Bangladesh. Look at the photo and return JSON: {"category": one word like kurti, t-shirt, three-piece, hijab, bag, frock, saree, panjabi, shoes, "colors": [simple color words], "pattern": optional, "material": optional best guess, "nameSuggestion": short English product name, "aliases": 3-6 words customers might type, in Banglish and Bangla script}. JSON only.',
                },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: hint ? `Seller said: ${hint}` : 'No caption.' },
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
                    },
                  ],
                },
              ],
              json: true,
              temperature: 0,
            },
            30_000,
          )
          return {
            value: parseJsonReply(out.text),
            inputUnits: out.inputUnits,
            outputUnits: out.outputUnits,
          }
        },
      })
      return productAttributes.parse(raw)
    },

    async image(prompt, size) {
      const ep = meta(env.META_IMAGE_MODEL, 'META_IMAGE_MODEL')
      const b64 = await tracked<string>(db, {
        purpose: 'image',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('image', ep.model, size, prompt),
        run: async () => {
          const body = await postJson<{ data?: { b64_json?: string; url?: string }[] }>(
            `${ep.baseUrl.replace(/\/$/, '')}/images/generations`,
            ep.key,
            { model: ep.model, prompt, size, n: 1, response_format: 'b64_json' },
            60_000,
          )
          const first = body.data?.[0]
          if (first?.b64_json) return { value: first.b64_json }
          if (first?.url) {
            const img = await request(first.url, { method: 'GET', timeoutMs: 30_000 })
            return { value: Buffer.from(await img.arrayBuffer()).toString('base64') }
          }
          throw new ModelError('image model returned no image')
        },
      })
      return Buffer.from(b64, 'base64')
    },
  }
}
