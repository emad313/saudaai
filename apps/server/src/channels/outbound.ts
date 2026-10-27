import type { Outbound } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { sendMessenger } from './messenger.ts'
import { sendWebchat } from './webchat.ts'
import { sendWhatsApp } from './whatsapp.ts'

export function createOutbound(db: Db): Outbound {
  return {
    async send(c, msg) {
      if (c.channel === 'messenger') return sendMessenger(db, c, msg)
      if (c.channel === 'whatsapp') return sendWhatsApp(db, c, msg)
      if (c.channel === 'webchat') return sendWebchat(c.id, msg)
      throw new Error(`cannot send to ${c.channel} as a customer channel`)
    },
  }
}
