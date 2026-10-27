import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, gt, sql } from 'drizzle-orm'
import sharp from 'sharp'
import type { Deps, PendingAction } from '../src/agent/deps.ts'
import { runTurn } from '../src/agent/loop.ts'
import { sellerConversation } from '../src/agent/messaging.ts'
import { mentionsOffer } from '../src/agent/verify.ts'
import type { OutboundMessage } from '../src/channels/types.ts'
import { parseMessenger, type MessengerPayload } from '../src/channels/messenger.ts'
import { parseWhatsApp, type WhatsAppPayload } from '../src/channels/whatsapp.ts'
import { migrateDb, openDb, type Db } from '../src/db/client.ts'
import { newId } from '../src/db/ids.ts'
import {
  activityLog,
  conversations,
  customerIdentities,
  customers,
  expenses,
  messages,
  orderLines,
  orders,
  pendingActions,
  products,
  shops,
  variants,
} from '../src/db/schema.ts'
import { seedDemoShop } from '../src/db/seed.ts'
import { createInbox } from '../src/inbox.ts'
import { saveMedia } from '../src/media/store.ts'
import type { Models } from '../src/models/index.ts'
import type { EvalCase } from './case.ts'

export type CaseResult = {
  id: string
  category: string
  pass: boolean
  failures: string[]
  calls: { tool: string; decision: string }[]
  reply: string
  ms: number
}

async function png() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#8e1b22' } })
    .png()
    .toBuffer()
}

async function variantByKey(db: Db, key: string) {
  const [name, label] = key.split('/') as [string, string]
  const rows = await db
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(products.name, name))
  const v = rows.find((r) =>
    [r.v.size, r.v.color].some((x) => x?.toLowerCase() === label.toLowerCase()),
  )
  if (!v) throw new Error(`eval case refers to unknown variant ${key}`)
  return v.v
}

async function customerByName(db: Db, name: string) {
  const [c] = await db.select().from(customers).where(eq(customers.name, name))
  if (!c) throw new Error(`eval case refers to unknown customer ${name}`)
  return c
}

const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase())
const bangla = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!)

function metaPayload(channel: 'messenger' | 'whatsapp', text: string, at: number) {
  if (channel === 'messenger') {
    return parseMessenger(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE',
            messaging: [
              {
                sender: { id: 'PSID_EVAL' },
                recipient: { id: 'PAGE' },
                timestamp: at,
                message: { mid: `mid.${newId()}`, text },
              },
            ],
          },
        ],
      } as MessengerPayload,
      () => 'shop',
    )
  }
  return parseWhatsApp(
    {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PHONE' },
                contacts: [{ wa_id: '8801999000111', profile: { name: 'Eval' } }],
                messages: [
                  {
                    from: '8801999000111',
                    id: `wamid.${newId()}`,
                    timestamp: String(Math.floor(at / 1000)),
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    } as WhatsAppPayload,
    () => 'shop',
  )
}

export async function runCase(c: EvalCase, makeModels: (db: Db) => Models): Promise<CaseResult> {
  const started = Date.now()
  const db = openDb(`file:${join(mkdtempSync(join(tmpdir(), 'saudaai-eval-')), 'eval.db')}`)
  await migrateDb(db)
  const now = Date.now()
  let shop = await seedDemoShop(db, now)
  shop = { ...shop, telegramChatId: 'eval' }

  const notes: { text: string; choices?: string[] }[] = []
  const approvals: PendingAction[] = []
  const sent: OutboundMessage[] = []
  const deps: Deps = {
    db,
    models: makeModels(db),
    now: () => Date.now(),
    seller: {
      notify: async (_s, text, choices) => void notes.push({ text, choices }),
      askApproval: async (_s, p) => void approvals.push(p),
      settle: async () => undefined,
      sendMedia: async () => undefined,
    },
    outbound: { send: async (_c, m) => void sent.push(m) },
    render: {
      invoice: async () => saveMedia(db, await png(), 'image/png'),
      ad: async () => [await saveMedia(db, await png(), 'image/png')],
    },
  }

  const s = c.setup
  let input = c.input
  if (s.photo)
    input = input.replace(
      '{{media}}',
      (await saveMedia(db, await png(), 'image/jpeg', { role: 'catalog' })).id,
    )
  if (s.photoFor) {
    const m = await saveMedia(db, await png(), 'image/jpeg', { role: 'catalog' })
    await db.update(products).set({ imageId: m.id }).where(eq(products.name, s.photoFor))
  }
  if (s.auto) {
    await db.update(shops).set({ auto: s.auto }).where(eq(shops.id, shop.id))
    shop = { ...shop, auto: s.auto }
  }
  if (s.staleChat) {
    const cust = await customerByName(db, s.staleChat.customer)
    const at = now - s.staleChat.hoursAgo * 60 * 60 * 1000
    const ext = `ext_${newId()}`
    await db
      .insert(conversations)
      .values({
        id: newId(),
        shopId: shop.id,
        channel: s.staleChat.channel,
        externalUserId: ext,
        customerId: cust.id,
        lastInboundAt: at,
        createdAt: at,
      })
    await db
      .insert(customerIdentities)
      .values({
        id: newId(),
        customerId: cust.id,
        channel: s.staleChat.channel,
        externalUserId: ext,
        createdAt: at,
      })
  }

  const stockKeys = Object.keys(c.expect.stock ?? {})
  const before = new Map(
    await Promise.all(stockKeys.map(async (k) => [k, (await variantByKey(db, k)).stock] as const)),
  )
  const [baseline] = await db.select({ n: sql<number>`max(${orders.number})` }).from(orders)
  const lastNumber = Number(baseline?.n ?? 0)

  if (c.actor === 'seller') {
    const conv = await sellerConversation(deps, shop.id, 'eval')
    const conversationId = conv.id
    for (const [i, h] of c.history.entries()) {
      await db
        .insert(messages)
        .values({
          id: newId(),
          conversationId,
          role: h.role === 'agent' ? 'agent' : 'seller',
          kind: 'text',
          text: h.text,
          createdAt: now - 1000 * (c.history.length - i),
        })
    }
    await db.insert(messages).values({
      id: newId(),
      conversationId,
      role: 'seller',
      kind: c.inputKind,
      text: c.inputKind === 'text' ? input : null,
      transcript: c.inputKind === 'text' ? null : input,
      createdAt: now,
    })
    await runTurn(deps, { shop, actor: 'seller', conversation: conv, inputKind: c.inputKind })
  } else if (c.channel === 'webchat') {
    const conversationId = newId()
    const customerId = s.customer ? (await customerByName(db, s.customer)).id : null
    await db
      .insert(conversations)
      .values({
        id: conversationId,
        shopId: shop.id,
        channel: 'webchat',
        externalUserId: `web_${conversationId}`,
        customerId,
        lastInboundAt: now,
        createdAt: now,
      })
    for (const [i, h] of c.history.entries()) {
      await db
        .insert(messages)
        .values({
          id: newId(),
          conversationId,
          role: h.role === 'agent' ? 'agent' : 'customer',
          kind: 'text',
          text: h.text,
          createdAt: now - 1000 * (c.history.length - i),
        })
    }
    await db
      .insert(messages)
      .values({
        id: newId(),
        conversationId,
        role: 'customer',
        kind: 'text',
        text: input,
        createdAt: now,
      })
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId))
    await runTurn(deps, { shop, actor: 'customer', conversation: conv!, inputKind: 'text' })
  } else {
    const inbox = createInbox(deps)
    for (const m of metaPayload(c.channel, input, now))
      await inbox.customer({ ...m, shopId: shop.id })
    await inbox.idle()
  }

  const failures = await check(c, {
    db,
    shopId: shop.id,
    since: now,
    lastNumber,
    before,
    notes,
    approvals,
    sent,
  })
  const calls = await db.select().from(activityLog).orderBy(activityLog.createdAt, activityLog.step)
  return {
    id: c.id,
    category: c.category,
    pass: failures.length === 0,
    failures,
    calls: calls.map((r) => ({ tool: r.tool, decision: r.decision })),
    reply: replyOf(c, notes, sent),
    ms: Date.now() - started,
  }
}

function replyOf(c: EvalCase, notes: { text: string }[], sent: OutboundMessage[]) {
  if (c.actor === 'seller') return notes.map((n) => n.text).join('\n')
  return sent
    .map((m) =>
      m.kind === 'text'
        ? m.text
        : m.kind === 'image'
          ? `[image] ${m.caption ?? ''}`
          : m.fallbackText,
    )
    .join('\n')
}

type State = {
  db: Db
  shopId: string
  since: number
  lastNumber: number
  before: Map<string, number>
  notes: { text: string; choices?: string[] }[]
  approvals: PendingAction[]
  sent: OutboundMessage[]
}

async function check(c: EvalCase, st: State): Promise<string[]> {
  const e = c.expect
  const { db } = st
  const out: string[] = []
  const reply = replyOf(c, st.notes, st.sent)
  const newOrders = await db
    .select()
    .from(orders)
    .where(gt(orders.number, st.lastNumber))
    .orderBy(orders.number)
  const pending = await db
    .select()
    .from(pendingActions)
    .where(gt(pendingActions.createdAt, st.since - 1))
  const calls = await db.select().from(activityLog)

  if (e.order) {
    const o = newOrders.at(-1)
    if (!o) out.push('expected an order, none was created')
    else {
      const lines = await db
        .select({ l: orderLines, v: variants, p: products })
        .from(orderLines)
        .innerJoin(variants, eq(variants.id, orderLines.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(eq(orderLines.orderId, o.id))
      const got = lines
        .map(({ l, v, p }) => `${p.name}/${v.size ?? v.color} x${l.qty}`.toLowerCase())
        .sort()
      const want = [...e.order.items].map((i) => i.toLowerCase()).sort()
      const labels = lines.map(({ l, v, p }) =>
        [`${p.name}/${v.size} x${l.qty}`, `${p.name}/${v.color} x${l.qty}`].map((x) =>
          x.toLowerCase(),
        ),
      )
      const matched =
        want.every((w) => labels.some((ls) => ls.includes(w))) && lines.length === want.length
      if (!matched) out.push(`order items ${JSON.stringify(got)} != ${JSON.stringify(want)}`)
      if (e.order.paymentMethod && o.paymentMethod !== e.order.paymentMethod)
        out.push(`payment ${o.paymentMethod} != ${e.order.paymentMethod}`)
      if (e.order.status && o.status !== e.order.status)
        out.push(`status ${o.status} != ${e.order.status}`)
      if (e.order.source && o.source !== e.order.source)
        out.push(`source ${o.source} != ${e.order.source}`)
      if (e.order.deliveryTaka !== undefined && o.deliveryPoisha !== e.order.deliveryTaka * 100)
        out.push(`delivery ${o.deliveryPoisha / 100} != ${e.order.deliveryTaka}`)
      if (e.order.customer) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, o.customerId))
        if (!cust || !has(cust.name, e.order.customer))
          out.push(`customer ${cust?.name} != ${e.order.customer}`)
      }
    }
  }
  if (e.noOrder && newOrders.length)
    out.push(`expected no order, got #${newOrders.map((o) => o.number).join(', #')}`)

  const tools = pending.map((p) => p.tool)
  if (e.pending) {
    const want = [...new Set(e.pending)].sort()
    const got = [...new Set(tools)].sort()
    if (JSON.stringify(want) !== JSON.stringify(got))
      out.push(`pending ${JSON.stringify(got)} != ${JSON.stringify(want)}`)
  }
  if (e.noPending && tools.filter((t) => t !== 'customer_reply').length)
    out.push(`expected no approvals, got ${tools.join(', ')}`)
  for (const [tool, args] of Object.entries(e.pendingArgs ?? {})) {
    const hit = pending.some(
      (p) => p.tool === tool && Object.entries(args).every(([k, v]) => p.args[k] === v),
    )
    if (!hit)
      out.push(
        `no pending ${tool} with ${JSON.stringify(args)}; got ${JSON.stringify(pending.map((p) => [p.tool, p.args]))}`,
      )
  }

  for (const [number, status] of Object.entries(e.orderStatus ?? {})) {
    const [o] = await db
      .select()
      .from(orders)
      .where(eq(orders.number, Number(number)))
    if (o?.status !== status) out.push(`order #${number} is ${o?.status}, expected ${status}`)
  }
  for (const [number, paid] of Object.entries(e.orderPaid ?? {})) {
    const [o] = await db
      .select()
      .from(orders)
      .where(eq(orders.number, Number(number)))
    if (o?.paidPoisha !== paid * 100)
      out.push(`order #${number} paid ${(o?.paidPoisha ?? 0) / 100}, expected ${paid}`)
  }
  for (const [key, delta] of Object.entries(e.stock ?? {})) {
    const now = (await variantByKey(db, key)).stock
    const was = st.before.get(key)!
    if (now - was !== delta) out.push(`stock ${key} changed by ${now - was}, expected ${delta}`)
  }

  const added = await db
    .select()
    .from(products)
    .where(gt(products.createdAt, st.since - 1))
  if (e.product) {
    const p = await db
      .select()
      .from(products)
      .where(and(eq(products.shopId, st.shopId), eq(products.status, 'draft')))
    const made = p.at(-1)
    if (!made) out.push('expected a draft product, none was created')
    else {
      const vs = await db.select().from(variants).where(eq(variants.productId, made.id))
      if (made.basePricePoisha !== e.product.priceTaka * 100)
        out.push(`price ${made.basePricePoisha / 100} != ${e.product.priceTaka}`)
      if (vs.length !== e.product.variants)
        out.push(`${vs.length} variants, expected ${e.product.variants}`)
      if (e.product.stockEach !== undefined && vs.some((v) => v.stock !== e.product!.stockEach))
        out.push(`stock per variant ${vs.map((v) => v.stock).join('/')} != ${e.product.stockEach}`)
      if (e.product.withPhoto && !made.imageId) out.push('product has no photo')
    }
  }
  if (e.noProduct && added.length)
    out.push(`expected no product, got ${added.map((p) => p.name).join(', ')}`)

  if (e.expense !== undefined) {
    const rows = await db
      .select()
      .from(expenses)
      .where(gt(expenses.createdAt, st.since - 1))
    if (!rows.some((r) => r.amountPoisha === e.expense! * 100))
      out.push(`no expense of ${e.expense}`)
  }

  if (e.asks) {
    const choices = calls.some((r) => r.tool === 'offer_choices' && r.decision === 'run')
    if (!choices && !/[?？]/.test(reply)) out.push('expected a question back')
  }
  if (e.replyMentionsAvailable) {
    const v = await variantByKey(db, e.replyMentionsAvailable)
    const n = v.stock - v.reserved
    if (!has(reply, String(n)) && !reply.includes(bangla(n)))
      out.push(`reply does not mention ${n} available`)
  }
  for (const needle of e.reply?.notContainsAny ?? [])
    if (has(reply, needle)) out.push(`reply contains "${needle}"`)
  if (e.reply?.containsAny && !e.reply.containsAny.some((n) => has(reply, n))) {
    out.push(`reply has none of ${JSON.stringify(e.reply.containsAny)}`)
  }
  if (e.held !== undefined && tools.includes('customer_reply') !== e.held)
    out.push(`held for seller: ${!e.held}`)
  for (const name of e.calls ?? [])
    if (!calls.some((r) => r.tool === name && r.decision !== 'reject'))
      out.push(`did not call ${name}`)
  const images = st.sent.filter((m) => m.kind === 'image').length
  if (e.sentImages !== undefined && images < e.sentImages)
    out.push(`sent ${images} images, expected ${e.sentImages}`)
  if (e.sentMessages !== undefined && st.sent.length !== e.sentMessages)
    out.push(`sent ${st.sent.length} messages, expected ${e.sentMessages}`)
  if (e.noOffer && mentionsOffer(reply)) out.push('reply mentions an offer')
  return out
}
