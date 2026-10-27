import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { InboundMessage } from './channels/types.ts'
import { conversations, customerIdentities, messages } from './db/schema.ts'
import { createInbox } from './inbox.ts'
import { fakeDeps, say } from './test/deps.ts'
import { now, testShop } from './test/shop.ts'
import { createCustomer } from './tools/customers.ts'

let t: Awaited<ReturnType<typeof testShop>>

const inbound = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: 'whatsapp',
  shopId: t.shop.id,
  externalUserId: '8801811000202',
  externalMessageId: `wamid.${Math.random()}`,
  kind: 'text',
  text: 'XL ache?',
  profileName: 'Karim',
  receivedAt: now,
  ...over,
})

beforeEach(async () => {
  t = await testShop()
})

describe('inbox', () => {
  it('drops duplicate webhook deliveries', async () => {
    const f = fakeDeps(t.db, [say('Ji ache.')])
    const inbox = createInbox(f.deps)
    const m = inbound({ externalMessageId: 'wamid.same' })
    await inbox.customer(m)
    await inbox.customer(m)
    await inbox.idle()
    expect(f.seen).toHaveLength(1)
    expect(await t.db.select().from(messages).where(eq(messages.role, 'customer'))).toHaveLength(1)
  })

  it('transcribes customer voice notes before the agent sees them', async () => {
    const f = fakeDeps(t.db, [say('Ji.')])
    const inbox = createInbox(f.deps)
    await inbox.customer(
      inbound({
        kind: 'voice',
        text: undefined,
        media: { mime: 'audio/ogg', fetch: async () => Buffer.from('ogg') },
      }),
    )
    await inbox.idle()
    const last = f.seen[0]!.messages.at(-1)!
    expect(last).toEqual({ role: 'user', content: '[voice note] transcript' })
  })

  it('forwards to the seller instead of answering while the seller has the chat', async () => {
    const f = fakeDeps(t.db, [say('Ji.')])
    const inbox = createInbox(f.deps)
    await inbox.customer(inbound())
    await inbox.idle()
    await t.db.update(conversations).set({ pausedUntil: now + 60_000 })
    f.notes.length = 0
    await inbox.customer(inbound({ text: 'hello?' }))
    await inbox.idle()
    expect(f.seen).toHaveLength(1)
    expect(f.notes[0]!.text).toContain('Karim: hello?')
  })

  it('recognises a returning customer on a new channel by identity', async () => {
    const c = await createCustomer(t.ctx(), { name: 'Karim', phone: '01811000202' })
    await t.db.insert(customerIdentities).values({
      id: 'ident1',
      customerId: c.customerId,
      channel: 'whatsapp',
      externalUserId: '8801811000202',
      createdAt: now,
    })
    const f = fakeDeps(t.db, [say('Ji.')])
    const inbox = createInbox(f.deps)
    await inbox.customer(inbound())
    await inbox.idle()
    const [conv] = await t.db
      .select()
      .from(conversations)
      .where(eq(conversations.channel, 'whatsapp'))
    expect(conv!.customerId).toBe(c.customerId)
  })

  it('stops answering a customer who floods the chat', async () => {
    const f = fakeDeps(
      t.db,
      Array.from({ length: 40 }, () => say('ok')),
    )
    const inbox = createInbox(f.deps)
    for (let i = 0; i < 35; i++) await inbox.customer(inbound())
    await inbox.idle()
    expect(f.seen.length).toBeLessThanOrEqual(31)
    expect(f.notes.some((n) => n.text.startsWith('Too many messages'))).toBe(true)
  })
})
