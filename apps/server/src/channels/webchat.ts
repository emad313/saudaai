import type { OutboundMessage } from './types.ts'

export type WebEvent = {
  role: 'agent' | 'seller'
  kind: 'text' | 'image' | 'typing'
  text?: string
  quickReplies?: string[]
  imageUrl?: string
  at: number
}

type Listener = (e: WebEvent) => void

// keyed by the web chat session id, which is the conversation's externalUserId
const listeners = new Map<string, Set<Listener>>()

export function subscribe(session: string, fn: Listener) {
  const set = listeners.get(session) ?? new Set()
  set.add(fn)
  listeners.set(session, set)
  return () => {
    set.delete(fn)
    if (!set.size) listeners.delete(session)
  }
}

export function sendTyping(session: string) {
  for (const fn of listeners.get(session) ?? [])
    fn({ role: 'agent', kind: 'typing', at: Date.now() })
}

export function sendWebchat(
  session: string,
  msg: OutboundMessage,
  role: 'agent' | 'seller' = 'agent',
) {
  const event: WebEvent =
    msg.kind === 'image'
      ? {
          role,
          kind: 'image',
          imageUrl: `/media/${msg.mediaId}`,
          text: msg.caption,
          at: Date.now(),
        }
      : {
          role,
          kind: 'text',
          text: msg.kind === 'text' ? msg.text : msg.fallbackText,
          quickReplies: msg.kind === 'text' ? msg.quickReplies : undefined,
          at: Date.now(),
        }
  for (const fn of listeners.get(session) ?? []) fn(event)
}
