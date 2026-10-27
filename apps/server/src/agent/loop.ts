import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { newId } from '../db/ids.ts'
import { activityLog, conversations } from '../db/schema.ts'
import { log } from '../log.ts'
import type { ChatMessage, ToolCall, ToolSpec } from '../models/chat.ts'
import { ToolError, type Actor, type Shop } from '../tools/ctx.ts'
import { contextBlock, history } from './context.ts'
import { handoffReply, holdingReply, retryReply } from './copy.ts'
import type { Conversation, Deps } from './deps.ts'
import { logMessage, sendToCustomer } from './messaging.ts'
import { propose } from './pending.ts'
import { customerPrompt, sellerPrompt, shopFacts } from './prompt.ts'
import { toolByName, toolsFor, type ToolDef, type TurnCtx } from './registry.ts'
import { checkCustomerReply, numbersIn, verifyOrders } from './verify.ts'

const maxSteps = 6

export type CallTrace = {
  name: string
  args: unknown
  decision: 'run' | 'pending' | 'reject' | 'invalid' | 'error'
  ok: boolean
  result: unknown
}

export type TurnResult = {
  turnId: string
  calls: CallTrace[]
  reply: string | null
  heldForSeller: boolean
  failed: boolean
}

function specs(defs: ToolDef[]): ToolSpec[] {
  return defs.map((d) => {
    const { $schema: _, ...parameters } = z.toJSONSchema(d.schema) as Record<string, unknown>
    return { type: 'function', function: { name: d.name, description: d.description, parameters } }
  })
}

type Turn = {
  ctx: TurnCtx
  allowed: Set<string>
  calls: CallTrace[]
  done: string[]
  orderIds: Set<string>
  facts: Set<string>
  ended: boolean
}

async function record(turn: Turn, step: number, trace: CallTrace, started: number) {
  turn.calls.push(trace)
  await turn.ctx.db.insert(activityLog).values({
    id: newId(),
    shopId: turn.ctx.shop.id,
    turnId: turn.ctx.turnId,
    actor: turn.ctx.actor,
    step,
    tool: trace.name,
    args: trace.args,
    result: trace.result,
    decision: trace.decision,
    latencyMs: Date.now() - started,
    createdAt: turn.ctx.now,
  })
}

async function execute(turn: Turn, call: ToolCall, step: number): Promise<unknown> {
  const started = Date.now()
  const name = call.function.name
  const def = toolByName.get(name)
  if (!def || !turn.allowed.has(name)) {
    const result = { ok: false, error: 'not_allowed', message: `${name} is not available here` }
    await record(
      turn,
      step,
      { name, args: call.function.arguments, decision: 'reject', ok: false, result },
      started,
    )
    return result
  }
  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments || '{}')
  } catch {
    const result = { ok: false, error: 'invalid_json', message: 'arguments were not valid JSON' }
    await record(
      turn,
      step,
      { name, args: call.function.arguments, decision: 'invalid', ok: false, result },
      started,
    )
    return result
  }
  const parsed = def.schema.safeParse(raw)
  if (!parsed.success) {
    const result = {
      ok: false,
      error: 'invalid_args',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
    await record(turn, step, { name, args: raw, decision: 'invalid', ok: false, result }, started)
    return result
  }
  const args = parsed.data as Record<string, unknown>
  try {
    if (def.guard && (await def.guard(turn.ctx, args as never))) {
      const result = await propose(turn.ctx, name, args)
      await record(turn, step, { name, args, decision: 'pending', ok: true, result }, started)
      return result
    }
    const value = (await def.run(turn.ctx, args as never)) as Record<string, unknown>
    if (typeof value?.orderId === 'string') turn.orderIds.add(value.orderId)
    if (def.done) turn.done.push(def.done(value as never))
    if (def.endsTurn) turn.ended = true
    const result = { ok: true, ...value }
    await record(turn, step, { name, args, decision: 'run', ok: true, result }, started)
    return result
  } catch (err) {
    if (!(err instanceof ToolError))
      log.error({ err, tool: name, turnId: turn.ctx.turnId }, 'tool failed')
    const result =
      err instanceof ToolError
        ? { ok: false, error: err.code, message: err.message }
        : {
            ok: false,
            error: 'internal',
            message: 'the tool failed, try something else or ask the seller',
          }
    await record(turn, step, { name, args, decision: 'error', ok: false, result }, started)
    return result
  }
}

async function plan(deps: Deps, turn: Turn, messages: ChatMessage[]) {
  const tools = specs(toolsFor(turn.ctx.actor))
  for (let step = 1; step <= maxSteps; step++) {
    const res = await deps.models.plan(messages, tools)
    if (!res.toolCalls.length) return res.text
    messages.push({ role: 'assistant', content: res.text || null, tool_calls: res.toolCalls })
    for (const call of res.toolCalls) {
      const out = await execute(turn, call, step)
      const content = JSON.stringify(out)
      for (const n of numbersIn(content)) turn.facts.add(n)
      messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, 6000) })
    }
    if (turn.ended) return null
  }
  throw new Error('agent did not finish within the step limit')
}

async function customerFailed(deps: Deps, ctx: TurnCtx, conversation: Conversation) {
  const failures = conversation.failures + 1
  if (failures >= 2) {
    await deps.db
      .update(conversations)
      .set({ failures: 0, pausedUntil: ctx.now + 2 * 60 * 60 * 1000 })
      .where(eq(conversations.id, conversation.id))
    await sendToCustomer(deps, conversation, { kind: 'text', text: handoffReply }).catch(
      () => undefined,
    )
    await deps.seller.notify(
      ctx.shop,
      `${conversation.profileName ?? 'A customer'} (${conversation.channel}) is waiting, the assistant could not answer.\nReply with /reply ${conversation.id} <text>`,
    )
    return
  }
  await deps.db.update(conversations).set({ failures }).where(eq(conversations.id, conversation.id))
  await sendToCustomer(deps, conversation, { kind: 'text', text: retryReply }).catch(
    () => undefined,
  )
}

export async function runTurn(
  deps: Deps,
  input: {
    shop: Shop
    actor: Actor
    conversation: Conversation
    inputKind: TurnCtx['inputKind']
  },
): Promise<TurnResult> {
  const { shop, actor, conversation } = input
  const ctx: TurnCtx = {
    db: deps.db,
    deps,
    shop,
    actor,
    now: deps.now(),
    conversation,
    conversationId: conversation.id,
    customerId: conversation.customerId,
    turnId: newId(),
    inputKind: input.inputKind,
  }
  const turn: Turn = {
    ctx,
    allowed: new Set(toolsFor(actor).map((t) => t.name)),
    calls: [],
    done: [],
    orderIds: new Set(),
    facts: new Set(),
    ended: false,
  }
  const context = await contextBlock(ctx)
  for (const n of numbersIn(`${context}\n${shopFacts(shop)}`)) turn.facts.add(n)
  const past = await history(ctx, conversation.id)
  const said = new Set(
    past.filter((m) => m.role === 'user').flatMap((m) => numbersIn(String(m.content))),
  )
  const system =
    actor === 'customer'
      ? customerPrompt(shop, ctx.now, context)
      : sellerPrompt(shop, ctx.now, context)
  const result: TurnResult = {
    turnId: ctx.turnId,
    calls: turn.calls,
    reply: null,
    heldForSeller: false,
    failed: false,
  }

  let final: string | null
  try {
    final = await plan(deps, turn, [{ role: 'system', content: system }, ...past])
  } catch (err) {
    log.error({ err, turnId: ctx.turnId, actor }, 'agent turn failed')
    result.failed = true
    if (actor === 'customer') await customerFailed(deps, ctx, conversation)
    else
      await deps.seller.notify(
        shop,
        'Model is not responding right now. Please try again in a minute.',
      )
    return result
  }

  const problems = await verifyOrders(deps.db, [...turn.orderIds])
  if (problems.length) {
    log.error({ turnId: ctx.turnId, problems }, 'verification failed')
    await deps.seller.notify(shop, `Check failed, please review: ${problems.join('; ')}`)
  }

  if (actor !== 'customer') {
    const text = [turn.ended ? null : final, ...turn.done.map((l) => `• ${l}`)]
      .filter(Boolean)
      .join('\n')
    if (text) {
      await deps.seller.notify(shop, text)
      await logMessage(deps, conversation.id, 'agent', { kind: 'text', text })
    }
    result.reply = text || null
    return result
  }

  if (conversation.failures) {
    await deps.db
      .update(conversations)
      .set({ failures: 0 })
      .where(eq(conversations.id, conversation.id))
  }
  if (turn.ended || !final) return result
  const issue = checkCustomerReply(final, turn.facts, said)
  if (issue) {
    log.info({ turnId: ctx.turnId, issue }, 'customer reply held for seller')
    await propose(ctx, 'customer_reply', { conversationId: conversation.id, text: final })
    await sendToCustomer(deps, conversation, { kind: 'text', text: holdingReply })
    result.heldForSeller = true
    result.reply = holdingReply
    return result
  }
  await sendToCustomer(deps, conversation, { kind: 'text', text: final })
  result.reply = final
  if (!shop.feedMuted) {
    const asked = past.filter((m) => m.role === 'user').at(-1)?.content
    const who = conversation.profileName ?? 'Customer'
    await deps.seller.notify(
      shop,
      `[${conversation.channel}] ${who}: ${String(asked ?? '')}
-> ${final}`,
    )
  }
  return result
}
