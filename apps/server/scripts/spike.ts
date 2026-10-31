import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { migrateDb, openDb } from '../src/db/client.ts'
import { env } from '../src/env.ts'
import { createModels } from '../src/models/index.ts'

const { values } = parseArgs({ options: { audio: { type: 'string' }, image: { type: 'string' } } })
const dir = mkdtempSync(join(tmpdir(), 'spike-'))
const db = openDb(`file:${join(dir, 'spike.db')}`)
await migrateDb(db)

const seen: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  const res = await realFetch(input, init)
  const line = `${init?.method ?? 'GET'} ${url} -> ${res.status}`
  seen.push(res.ok ? line : `${line}\n      body: ${(await res.clone().text()).slice(0, 300)}`)
  return res
}

async function check(name: string, fn: () => Promise<unknown>) {
  seen.length = 0
  const started = Date.now()
  let status = 'ok  '
  let detail: string
  try {
    detail = JSON.stringify(await fn()).slice(0, 400)
  } catch (err) {
    status = 'FAIL'
    detail = (err instanceof Error ? err.message : String(err)).slice(0, 300)
  }
  console.log(`${status}  ${name} (${Date.now() - started}ms)`)
  for (const s of seen) console.log(`      ${s}`)
  console.log(`      ${detail}`)
}

const tool = {
  type: 'function' as const,
  function: {
    name: 'find_product',
    description: 'Search the shop catalog',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
}
const ask = [
  {
    role: 'system' as const,
    content: 'You help a Bangladeshi clothing shop. Use tools for catalog facts.',
  },
  { role: 'user' as const, content: 'kalo t-shirt ache?' },
]

for (const provider of ['meta', 'baseten'] as const) {
  const name = `plan with tool calling (${provider})`
  if (provider === 'baseten' && !env.BASETEN_API_KEY) {
    console.log(`skip  ${name} (no BASETEN_API_KEY)`)
    continue
  }
  const models = createModels(db, { ...env, AGENT_PROVIDER: provider })
  await check(name, async () => {
    const r = await models.plan(ask, [tool])
    if (!r.toolCalls.length) throw new Error(`no tool call, replied: ${r.text}`)
    return r.toolCalls.map((c) => c.function)
  })
}

const models = createModels(db, { ...env, AGENT_PROVIDER: 'meta' })
const photo = values.image
  ? readFileSync(values.image)
  : await sharp({ create: { width: 600, height: 800, channels: 3, background: '#7f1d1d' } })
      .jpeg()
      .toBuffer()

// Without a recording, a short tone still exercises the request shape; expect an empty transcript.
const audioPath = values.audio ?? join(dir, 'tone.ogg')
if (!values.audio) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=1', audioPath])
}
await check(`transcribe${values.audio ? '' : ' (1s tone, pass --audio for speech)'}`, () =>
  models.transcribe(readFileSync(audioPath), 'audio/ogg'),
)
await check('describe photo', () => models.describe(photo, 'eta 1250 taka'))
await check('segment photo', async () => {
  const mask = await models.segment(photo, 'kurti')
  if (!env.META_SAM_MODEL) throw new Error('META_SAM_MODEL is not set')
  if (!mask) return 'request ok, no object matched (pass --image with a real product photo)'
  writeFileSync('spike-mask.png', mask)
  return `mask saved to spike-mask.png (${mask.length} bytes)`
})
await check('image background', async () => {
  const img = await models.image(
    'Soft studio background for a maroon kurti, eid mood, no text',
    '1024x1024',
  )
  writeFileSync('spike-background.webp', img)
  return `saved spike-background.webp (${img.length} bytes)`
})
process.exit(0)
