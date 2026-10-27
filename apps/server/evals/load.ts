import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { evalCase, type EvalCase } from './case.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'cases')

export function loadCases(): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap((file) => {
      const raw = parse(readFileSync(join(dir, file), 'utf8')) as unknown[]
      return raw.map((item, i) => {
        const parsed = evalCase.safeParse(item)
        if (!parsed.success) {
          throw new Error(
            `${file} case ${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`,
          )
        }
        return { ...parsed.data, category: parsed.data.category ?? basename(file, '.yaml') }
      })
    })
}
