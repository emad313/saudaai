import sharp from 'sharp'
import type { Conversation, Deps, PendingAction } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { saveMedia } from '../media/store.ts'
import type { ChatMessage, ToolCall, ToolSpec } from '../models/chat.ts'
import type { Models, PlanResult } from '../models/index.ts'
import type { OutboundMessage } from '../channels/types.ts'
import { now } from './shop.ts'

export type Step = PlanResult | ((messages: ChatMessage[], tools: ToolSpec[]) => PlanResult)

export const say = (text: string): PlanResult => ({
  text,
  toolCalls: [],
  inputUnits: 0,
  outputUnits: 0,
})

let n = 0
export const call = (name: string, args: unknown): ToolCall => ({
  id: `call_${++n}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

export const calls = (...list: ToolCall[]): PlanResult => ({
  text: '',
  toolCalls: list,
  inputUnits: 0,
  outputUnits: 0,
})

async function png() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: '#0f766e' } })
    .png()
    .toBuffer()
}

export function fakeDeps(db: Db, script: Step[] = []) {
  const queue = [...script]
  const seen: { messages: ChatMessage[]; tools: ToolSpec[] }[] = []
  const notes: { text: string; choices?: string[] }[] = []
  const approvals: PendingAction[] = []
  const settled: { pending: PendingAction; outcome: string }[] = []
  const sellerMedia: string[][] = []
  const sent: { conversation: Conversation; msg: OutboundMessage }[] = []

  const models: Models = {
    agentProvider: 'script',
    async plan(messages, tools) {
      seen.push({ messages: structuredClone(messages), tools })
      const next = queue.shift()
      if (!next) throw new Error('script exhausted')
      return typeof next === 'function' ? next(messages, tools) : next
    },
    async transcribe() {
      return 'transcript'
    },
    async segment() {
      return null
    },
    async describe() {
      return { category: 'kurti', colors: ['maroon'], nameSuggestion: 'Maroon Kurti', aliases: [] }
    },
    async image() {
      return png()
    },
  }

  const deps: Deps = {
    db,
    models,
    now: () => now,
    seller: {
      async notify(_shop, text, choices) {
        notes.push({ text, choices })
      },
      async askApproval(_shop, pending) {
        approvals.push(pending)
      },
      async settle(_shop, pending, outcome) {
        settled.push({ pending, outcome })
      },
      async sendMedia(_shop, ids) {
        sellerMedia.push(ids)
      },
    },
    outbound: {
      async send(conversation, msg) {
        sent.push({ conversation, msg })
      },
    },
    render: {
      async invoice() {
        return saveMedia(db, await png(), 'image/png')
      },
      async ad() {
        return [await saveMedia(db, await png(), 'image/png')]
      },
    },
  }
  return {
    deps,
    seen,
    notes,
    approvals,
    settled,
    sellerMedia,
    sent,
    push: (s: Step) => queue.push(s),
  }
}
