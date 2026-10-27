import type { Conversation } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { env } from '../env.ts'
import { loadMedia } from '../media/store.ts'
import { ToolError } from '../tools/ctx.ts'
import { download, graph, graphGet } from './meta.ts'
import type { InboundMessage, OutboundMessage } from './types.ts'

type WaMessage = {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  audio?: { id: string; mime_type: string }
  image?: { id: string; mime_type: string; caption?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }
  button?: { text: string }
}
type Value = {
  metadata: { phone_number_id: string }
  contacts?: { wa_id: string; profile?: { name?: string } }[]
  messages?: WaMessage[]
}
export type WhatsAppPayload = {
  object: 'whatsapp_business_account'
  entry: { changes: { field: string; value: Value }[] }[]
}

function token() {
  if (!env.WHATSAPP_TOKEN) throw new ToolError('not_configured', 'WhatsApp is not configured')
  return env.WHATSAPP_TOKEN
}

async function fetchMedia(id: string) {
  const meta = await graphGet(id, token())
  return download(String(meta.url), token())
}

export function parseWhatsApp(
  body: WhatsAppPayload,
  shopFor: (phoneNumberId: string) => string | null,
): InboundMessage[] {
  const out: InboundMessage[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value
      const shopId = shopFor(v.metadata?.phone_number_id)
      if (!shopId || !v.messages) continue
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]))
      for (const m of v.messages) {
        const base = {
          channel: 'whatsapp' as const,
          shopId,
          externalUserId: m.from,
          externalMessageId: m.id,
          profileName: names.get(m.from) ?? undefined,
          receivedAt: Number(m.timestamp) * 1000,
        }
        const media = m.audio ?? m.image
        if (media) {
          out.push({
            ...base,
            kind: m.audio ? 'voice' : 'image',
            text: m.image?.caption,
            media: { mime: media.mime_type, fetch: () => fetchMedia(media.id) },
          })
          continue
        }
        const text =
          m.text?.body ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          m.button?.text ??
          (m.location
            ? `[location ${m.location.latitude},${m.location.longitude}${m.location.address ? ` ${m.location.address}` : ''}]`
            : undefined)
        out.push(
          text
            ? { ...base, kind: m.location ? 'location' : 'text', text }
            : { ...base, kind: 'unsupported' },
        )
      }
    }
  }
  return out
}

function send(body: Record<string, unknown>) {
  return graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, token(), {
    messaging_product: 'whatsapp',
    ...body,
  })
}

function interactive(text: string, options: string[]) {
  if (options.length <= 3) {
    return {
      type: 'button',
      body: { text },
      action: {
        buttons: options.map((title, i) => ({
          type: 'reply',
          reply: { id: `o${i}`, title: title.slice(0, 20) },
        })),
      },
    }
  }
  return {
    type: 'list',
    body: { text },
    action: {
      button: 'Options',
      sections: [
        {
          title: 'Options',
          rows: options
            .slice(0, 10)
            .map((title, i) => ({ id: `o${i}`, title: title.slice(0, 24) })),
        },
      ],
    },
  }
}

export async function sendWhatsApp(db: Db, c: Conversation, msg: OutboundMessage) {
  const to = c.externalUserId
  if (msg.kind === 'text') {
    if (msg.quickReplies?.length) {
      await send({ to, type: 'interactive', interactive: interactive(msg.text, msg.quickReplies) })
    } else {
      await send({ to, type: 'text', text: { body: msg.text } })
    }
    return
  }
  if (msg.kind === 'template') {
    await send({
      to,
      type: 'template',
      template: {
        name: env.WHATSAPP_REMINDER_TEMPLATE,
        language: { code: env.WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: msg.params.map((text) => ({ type: 'text', text })) },
        ],
      },
    })
    return
  }
  const file = await loadMedia(db, msg.mediaId)
  if (!file) throw new ToolError('not_found', 'media not found')
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', file.row.mime)
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.row.mime }), 'image')
  const uploaded = await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/media`, token(), form)
  await send({
    to,
    type: 'image',
    image: { id: uploaded.id, ...(msg.caption ? { caption: msg.caption } : {}) },
  })
}
