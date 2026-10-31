import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import messengerVoice from '../test/fixtures/messenger-voice.json' with { type: 'json' }
import whatsappMixed from '../test/fixtures/whatsapp-mixed.json' with { type: 'json' }
import { env } from '../env.ts'
import { validSignature } from './meta.ts'
import { parseMessenger, sendMessenger, type MessengerPayload } from './messenger.ts'
import { parseWhatsApp, type WhatsAppPayload } from './whatsapp.ts'
import { canSendFreeform } from './window.ts'

describe('meta signature', () => {
  const raw = '{"object":"page"}'
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

  it('accepts the app secret signature', () => {
    expect(validSignature(raw, sign('s3cret'), 's3cret')).toBe(true)
  })

  it('rejects other secrets, missing and malformed headers', () => {
    expect(validSignature(raw, sign('other'), 's3cret')).toBe(false)
    expect(validSignature(raw, undefined, 's3cret')).toBe(false)
    expect(validSignature(raw, 'sha256=abc', 's3cret')).toBe(false)
  })
})

describe('parseMessenger', () => {
  const msgs = parseMessenger(messengerVoice as MessengerPayload, (id) =>
    id === 'PAGE_ID' ? 'shop1' : null,
  )

  it('turns attachments and text into inbound messages and skips echoes', () => {
    expect(msgs.map((m) => [m.kind, m.externalMessageId, m.text])).toEqual([
      ['voice', 'm_voice_1', undefined],
      ['text', 'm_text_1', 'XL ache?'],
    ])
    expect(msgs[0]).toMatchObject({
      channel: 'messenger',
      shopId: 'shop1',
      externalUserId: 'PSID_KARIM',
    })
  })

  it('ignores pages that belong to no shop', () => {
    expect(parseMessenger(messengerVoice as MessengerPayload, () => null)).toEqual([])
  })
})

describe('parseWhatsApp', () => {
  const msgs = parseWhatsApp(whatsappMixed as WhatsAppPayload, (id) =>
    id === 'PHONE_ID' ? 'shop1' : null,
  )

  it('reads text, button replies, images, locations and marks the rest unsupported', () => {
    expect(msgs.map((m) => [m.kind, m.text])).toEqual([
      ['text', 'amar order kothay?'],
      ['text', 'L'],
      ['image', 'eta ache?'],
      ['location', '[location 23.8,90.36 Mirpur 10]'],
      ['unsupported', undefined],
    ])
    expect(msgs[0]).toMatchObject({
      externalUserId: '8801711000101',
      profileName: 'Rahim',
      receivedAt: 1793080000000,
    })
  })
})

describe('canSendFreeform', () => {
  const conv = (channel: 'whatsapp' | 'messenger' | 'webchat', lastInboundAt: number) =>
    ({ channel, lastInboundAt }) as Parameters<typeof canSendFreeform>[0]
  const day = 24 * 60 * 60 * 1000

  it('allows replies inside 24 hours on meta channels only', () => {
    expect(canSendFreeform(conv('whatsapp', 0), day - 11 * 60 * 1000)).toBe(true)
    expect(canSendFreeform(conv('messenger', 0), day)).toBe(false)
    expect(canSendFreeform(conv('webchat', 0), 10 * day)).toBe(true)
  })
})

describe('instagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    env.MESSENGER_PAGE_TOKEN = undefined
  })

  it('parses dms like messenger, on the instagram channel', () => {
    const [m] = parseMessenger(
      {
        object: 'instagram',
        entry: [
          {
            id: 'IG_ID',
            messaging: [
              {
                sender: { id: 'IGSID' },
                recipient: { id: 'IG_ID' },
                timestamp: 1,
                message: { mid: 'm1', text: 'hi' },
              },
            ],
          },
        ],
      },
      (id) => (id === 'IG_ID' ? 'shop1' : null),
      'instagram',
    )
    expect(m).toMatchObject({ channel: 'instagram', externalUserId: 'IGSID', text: 'hi' })
  })

  it('sends images as a public url instead of an upload', async () => {
    env.MESSENGER_PAGE_TOKEN = 'page-token'
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) })
      return Response.json({ message_id: 'x' })
    })
    const conv = { channel: 'instagram', externalUserId: 'IGSID' } as Parameters<
      typeof sendMessenger
    >[1]
    await sendMessenger({} as Parameters<typeof sendMessenger>[0], conv, {
      kind: 'image',
      mediaId: 'med1',
    })
    expect(calls[0]!.url).toContain('/me/messages')
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      recipient: { id: 'IGSID' },
      message: {
        attachment: { type: 'image', payload: { url: expect.stringMatching(/\/media\/med1$/) } },
      },
    })
  })
})
