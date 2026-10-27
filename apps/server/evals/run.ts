import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { env } from '../src/env.ts'
import { createModels } from '../src/models/index.ts'
import { closeBrowser } from '../src/render/browser.ts'
import { runCase, type CaseResult } from './harness.ts'
import { loadCases } from './load.ts'

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: env.AGENT_PROVIDER },
    only: { type: 'string' },
    category: { type: 'string' },
  },
})
const provider = values.provider === 'meta' ? 'meta' : 'baseten'
const cases = loadCases().filter(
  (c) =>
    (!values.only || c.id === values.only) && (!values.category || c.category === values.category),
)

const results: CaseResult[] = []
for (const c of cases) {
  const r = await runCase(c, (db) => createModels(db, { ...env, AGENT_PROVIDER: provider }))
  results.push(r)
  console.log(
    `${r.pass ? 'pass' : 'FAIL'}  ${r.id}  ${r.ms}ms${r.pass ? '' : `\n      ${r.failures.join('\n      ')}\n      calls: ${r.calls.map((x) => `${x.tool}:${x.decision}`).join(' ')}\n      reply: ${r.reply.replace(/\n/g, ' | ').slice(0, 300)}`}`,
  )
}

const byCategory: Record<string, { passed: number; total: number }> = {}
for (const r of results) {
  const b = (byCategory[r.category] ??= { passed: 0, total: 0 })
  b.total++
  if (r.pass) b.passed++
}
const passed = results.filter((r) => r.pass).length
console.log(`\n${provider}: ${passed}/${results.length} passed`)
for (const [cat, b] of Object.entries(byCategory)) console.log(`  ${cat}: ${b.passed}/${b.total}`)

const model = provider === 'meta' ? env.META_AGENT_MODEL : env.BASETEN_MODEL
const out = join(dirname(fileURLToPath(import.meta.url)), 'reports', `${provider}.json`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `${JSON.stringify({ provider, model, ranAt: new Date().toISOString(), passed, total: results.length, byCategory, results }, null, 2)}\n`,
)
await closeBrowser()
process.exit(passed === results.length ? 0 : 1)
