import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { z } from 'zod'
import type { Db } from '../db/client.ts'
import type { Env } from '../env.ts'
import { complete, parseJsonReply, type ChatMessage, type Endpoint, type ToolSpec } from './chat.ts'
import { ModelError, postJson, request } from './http.ts'
import { bestMask } from './sam.ts'
import { dailyLimit, hashOf, tracked, type Call } from './track.ts'

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
      '-c:a',
      'pcm_s16le',
      '-map_metadata',
      '-1',
      join(dir, 'out.wav'),
    ])
    return await readFile(join(dir, 'out.wav'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function createModels(db: Db, env: Env): Models {
  const guard = dailyLimit(db, env.MODEL_DAILY_CALL_LIMIT)
  const track = <T>(call: Call<T>) => tracked(db, call, guard)
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
    env.AGENT_PROVIDER === 'baseten' ? baseten() : meta(env.META_AGENT_MODEL, 'META_AGENT_MODEL')
  // Muse Spark is multimodal, so the agent model covers vision and audio when no dedicated id is set.
  const vision = () =>
    env.META_VISION_MODEL
      ? meta(env.META_VISION_MODEL, 'META_VISION_MODEL')
      : meta(env.META_AGENT_MODEL, 'META_AGENT_MODEL')

  return {
    agentProvider: env.AGENT_PROVIDER,

    async plan(messages, tools) {
      const ep = agent()
      return track({
        purpose: 'plan',
        provider: ep.provider,
        model: ep.model,
        run: async () => {
          const out = await complete(ep, { messages, tools }, 30_000)
          return { value: out, inputUnits: out.inputUnits, outputUnits: out.outputUnits }
        },
      })
    },

    async transcribe(audio) {
      if (env.META_TRANSCRIBE_MODEL) {
        const ep = meta(env.META_TRANSCRIBE_MODEL, 'META_TRANSCRIBE_MODEL')
        return track({
          purpose: 'transcribe',
          provider: ep.provider,
          model: ep.model,
          cacheKey: hashOf('transcribe', ep.model, audio),
          run: async () => {
            const form = new FormData()
            const settings = {
              model: ep.model,
              audioEncoding: 'WAV',
              mode: 'PUSH_TO_TALK',
              languageBias: ['Bengali', 'English'],
            }
            form.append(
              'request',
              new Blob([JSON.stringify(settings)], { type: 'application/json' }),
            )
            form.append(
              'audio',
              new Blob([new Uint8Array(await toWav(audio))], { type: 'audio/wav' }),
            )
            const res = await request(`${ep.baseUrl.replace(/\/$/, '')}/asr/transcribe`, {
              headers: { authorization: `Bearer ${ep.key}` },
              body: form,
              timeoutMs: 30_000,
            })
            const body = (await res.json()) as { transcript?: string }
            return { value: (body.transcript ?? '').trim() }
          },
        })
      }
      const ep = meta(env.META_AGENT_MODEL, 'META_AGENT_MODEL')
      return track({
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
      const mask = await track<string | null>({
        purpose: 'segment',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('segment', ep.model, prompt, image),
        run: async () => {
          // Rotate first so the boxes SAM returns line up with the oriented photo we compose.
          const upright = await sharp(image).rotate().jpeg({ quality: 90 }).toBuffer()
          const body = await postJson<{
            output?: { content?: { type: string; text?: string }[] }[]
          }>(
            `${ep.baseUrl.replace(/\/$/, '')}/responses`,
            ep.key,
            {
              model: ep.model,
              input: [
                {
                  type: 'message',
                  role: 'user',
                  content: [
                    { type: 'input_text', text: prompt },
                    {
                      type: 'input_image',
                      image_url: `data:image/jpeg;base64,${upright.toString('base64')}`,
                    },
                  ],
                },
              ],
              metadata: { include_confidence: 'true' },
            },
            30_000,
          )
          const text = (body.output ?? [])
            .flatMap((o) => o.content ?? [])
            .map((c) => c.text ?? '')
            .join('')
          const mask = await bestMask(text)
          return { value: mask ? mask.toString('base64') : null }
        },
      })
      return mask ? Buffer.from(mask, 'base64') : null
    },

    async describe(image, hint) {
      const ep = vision()
      const raw = await track<unknown>({
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
              schema: { name: 'product', schema: z.toJSONSchema(productAttributes) },
              reasoning: 'low',
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
      const b64 = await track<string>({
        purpose: 'image',
        provider: ep.provider,
        model: ep.model,
        cacheKey: hashOf('image', ep.model, size, prompt),
        run: async () => {
          const body = await postJson<{ data?: { b64_json?: string; url?: string }[] }>(
            `${ep.baseUrl.replace(/\/$/, '')}/images/generations`,
            ep.key,
            {
              model: ep.model,
              prompt,
              size,
              n: 1,
              response_format: 'b64_json',
              output_format: 'webp',
            },
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
