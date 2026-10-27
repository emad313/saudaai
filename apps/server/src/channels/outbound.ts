import type { Outbound } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { env } from '../env.ts'
import { messengerTyping, sendMessenger } from './messenger.ts'
import { sendTyping, sendWebchat } from './webchat.ts'
import { sendWhatsApp } from './whatsapp.ts'

export function createOutbound(db: Db): Outbound {
  return {
    async send(c, msg) {
      if (c.channel === 'messenger') return sendMessenger(db, c, msg)
      if (c.channel === 'whatsapp') return sendWhatsApp(db, c, msg)
      if (c.channel === 'webchat') return sendWebchat(c.externalUserId, msg)
      throw new Error(`cannot send to ${c.channel} as a customer channel`)
    },
    async typing(c) {
      if (c.channel === 'messenger' && env.MESSENGER_PAGE_TOKEN)
        await messengerTyping(c.externalUserId)
      if (c.channel === 'webchat') sendTyping(c.externalUserId)
    },
  }
}
