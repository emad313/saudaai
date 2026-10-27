import { describe, expect, it } from 'vitest'
import { call, calls, fakeDeps, say } from '../src/test/deps.ts'
import type { ChatMessage } from '../src/models/chat.ts'
import { runCase } from './harness.ts'
import { loadCases } from './load.ts'

const cases = loadCases()

function idFrom(messages: ChatMessage[], name: string, label: string) {
  const system = String(messages[0]!.content)
  const row = system.split('\n').find((l) => l.includes(`| ${name}`))!
  return new RegExp(`(\\w{12}):${label}=`).exec(row)![1]!
}

describe('eval cases', () => {
  it('has 40 well formed cases with unique ids', () => {
    expect(cases).toHaveLength(40)
    expect(new Set(cases.map((c) => c.id)).size).toBe(40)
  })
})

describe('harness', () => {
  const stockAdd = cases.find((c) => c.id === 'stock-add')!

  it('passes a run that does the right thing', async () => {
    const r = await runCase(stockAdd, (db) => {
      const f = fakeDeps(db, [
        (messages) =>
          calls(
            call('adjust_stock', {
              variantId: idFrom(messages, 'White Cotton T-Shirt', 'M/white'),
              delta: 10,
              reason: 'new stock',
            }),
          ),
        say('Sada T-Shirt M ekhon 16 ta.'),
      ])
      return f.deps.models
    })
    expect(r.failures).toEqual([])
    expect(r.pass).toBe(true)
  })

  it('fails a run that changes the wrong thing', async () => {
    const r = await runCase(stockAdd, (db) => {
      const f = fakeDeps(db, [
        (messages) =>
          calls(
            call('adjust_stock', {
              variantId: idFrom(messages, 'White Cotton T-Shirt', 'L/white'),
              delta: 10,
              reason: 'new stock',
            }),
          ),
        say('done'),
      ])
      return f.deps.models
    })
    expect(r.pass).toBe(false)
    expect(r.failures[0]).toContain('White Cotton T-Shirt/M changed by 0')
  })
})
