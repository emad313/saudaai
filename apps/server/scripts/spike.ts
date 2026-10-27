import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { migrateDb, openDb } from '../src/db/client.ts'
import { env } from '../src/env.ts'
import { createModels } from '../src/models/index.ts'

const { values } = parseArgs({ options: { audio: { type: 'string' }, image: { type: 'string' } } })
const db = openDb(`file:${join(mkdtempSync(join(tmpdir(), 'spike-')), 'spike.db')}`)
await migrateDb(db)

async function check(name: string, fn: () => Promise<unknown>) {
  const started = Date.now()
  try {
    const out = await fn()
    console.log(
      `ok    ${name} (${Date.now() - started}ms)\n      ${JSON.stringify(out).slice(0, 400)}`,
    )
  } catch (err) {
    console.log(
      `FAIL  ${name} (${Date.now() - started}ms)\n      ${err instanceof Error ? err.message : String(err)}`,
    )
  }
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

for (const provider of ['baseten', 'meta'] as const) {
  const models = createModels(db, { ...env, AGENT_PROVIDER: provider })
  await check(`plan with tool calling (${provider})`, async () => {
    const r = await models.plan(ask, [tool])
    if (!r.toolCalls.length) throw new Error(`no tool call, replied: ${r.text}`)
    return r.toolCalls.map((c) => c.function)
  })
}

const models = createModels(db, env)
const photo = values.image
  ? readFileSync(values.image)
  : await sharp({ create: { width: 600, height: 800, channels: 3, background: '#7f1d1d' } })
      .jpeg()
      .toBuffer()

if (values.audio) {
  await check('transcribe', () => models.transcribe(readFileSync(values.audio!), 'audio/ogg'))
} else {
  console.log('skip  transcribe (pass --audio path/to/voice.ogg)')
}
await check('describe photo', () => models.describe(photo, 'eta 1250 taka'))
await check('segment photo', async () => {
  const mask = await models.segment(photo, 'kurti')
  if (!mask) return 'META_SAM_MODEL not set, the pipeline will use the full photo'
  writeFileSync('spike-mask.png', mask)
  return `mask saved to spike-mask.png (${mask.length} bytes)`
})
await check('image background', async () => {
  const img = await models.image(
    'Soft studio background for a maroon kurti, eid mood, no text',
    '1024x1024',
  )
  writeFileSync('spike-background.png', img)
  return `saved spike-background.png (${img.length} bytes)`
})
process.exit(0)
