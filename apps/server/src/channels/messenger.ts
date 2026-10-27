import type { Conversation } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { env } from '../env.ts'
import { loadMedia } from '../media/store.ts'
import { ToolError } from '../tools/ctx.ts'
import { download, graph, graphGet } from './meta.ts'
import type { InboundMessage, OutboundMessage } from './types.ts'

type Attachment = { type: string; payload?: { url?: string } }
type Event = {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    quick_reply?: { payload: string }
    attachments?: Attachment[]
  }
}
export type MessengerPayload = { object: 'page'; entry: { id: string; messaging?: Event[] }[] }

function token() {
  if (!env.MESSENGER_PAGE_TOKEN)
    throw new ToolError('not_configured', 'Messenger is not configured')
  return env.MESSENGER_PAGE_TOKEN
}

export function parseMessenger(
  body: MessengerPayload,
  shopFor: (pageId: string) => string | null,
): InboundMessage[] {
  const out: InboundMessage[] = []
  for (const entry of body.entry ?? []) {
    const shopId = shopFor(entry.id)
    if (!shopId) continue
    for (const e of entry.messaging ?? []) {
      const m = e.message
      if (!m || m.is_echo) continue
      const base = {
        channel: 'messenger' as const,
        shopId,
        externalUserId: e.sender.id,
        externalMessageId: m.mid,
        receivedAt: e.timestamp,
      }
      const att = m.attachments?.[0]
      const url = att?.payload?.url
      if (att && url && (att.type === 'audio' || att.type === 'image')) {
        out.push({
          ...base,
          kind: att.type === 'audio' ? 'voice' : 'image',
          text: m.text,
          media: {
            mime: att.type === 'audio' ? 'audio/mp4' : 'image/jpeg',
            fetch: () => download(url),
          },
        })
      } else if (m.text) {
        out.push({ ...base, kind: 'text', text: m.text })
      } else {
        out.push({ ...base, kind: 'unsupported' })
      }
    }
  }
  return out
}

export async function messengerProfileName(psid: string) {
  if (!env.MESSENGER_PAGE_TOKEN) return null
  const p = await graphGet(`${psid}?fields=first_name,last_name`, env.MESSENGER_PAGE_TOKEN).catch(
    () => null,
  )
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || null : null
}

export async function messengerTyping(psid: string) {
  await graph('me/messages', token(), { recipient: { id: psid }, sender_action: 'typing_on' })
}

export async function sendMessenger(db: Db, c: Conversation, msg: OutboundMessage) {
  const recipient = { id: c.externalUserId }
  if (msg.kind === 'template')
    throw new ToolError('outside_window', 'Messenger has no message templates')
  if (msg.kind === 'text') {
    await graph('me/messages', token(), {
      recipient,
      messaging_type: 'RESPONSE',
      message: {
        text: msg.text,
        ...(msg.quickReplies?.length
          ? {
              quick_replies: msg.quickReplies.slice(0, 13).map((title) => ({
                content_type: 'text',
                title: title.slice(0, 20),
                payload: title,
              })),
            }
          : {}),
      },
    })
    return
  }
  const file = await loadMedia(db, msg.mediaId)
  if (!file) throw new ToolError('not_found', 'media not found')
  const form = new FormData()
  form.append('recipient', JSON.stringify(recipient))
  form.append('messaging_type', 'RESPONSE')
  form.append(
    'message',
    JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }),
  )
  form.append('filedata', new Blob([new Uint8Array(file.bytes)], { type: file.row.mime }), 'image')
  await graph('me/messages', token(), form)
  if (msg.caption) await sendMessenger(db, c, { kind: 'text', text: msg.caption })
}
