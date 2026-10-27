import { mediaUrl } from '../media/store.ts'
import type { OutboundMessage } from './types.ts'

export type WebEvent = {
  role: 'agent' | 'seller'
  kind: 'text' | 'image'
  text?: string
  quickReplies?: string[]
  imageUrl?: string
  at: number
}

type Listener = (e: WebEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribe(conversationId: string, fn: Listener) {
  const set = listeners.get(conversationId) ?? new Set()
  set.add(fn)
  listeners.set(conversationId, set)
  return () => {
    set.delete(fn)
    if (!set.size) listeners.delete(conversationId)
  }
}

export function sendWebchat(
  conversationId: string,
  msg: OutboundMessage,
  role: 'agent' | 'seller' = 'agent',
) {
  const event: WebEvent =
    msg.kind === 'image'
      ? { role, kind: 'image', imageUrl: mediaUrl(msg.mediaId), text: msg.caption, at: Date.now() }
      : {
          role,
          kind: 'text',
          text: msg.kind === 'text' ? msg.text : msg.fallbackText,
          quickReplies: msg.kind === 'text' ? msg.quickReplies : undefined,
          at: Date.now(),
        }
  for (const fn of listeners.get(conversationId) ?? []) fn(event)
}
