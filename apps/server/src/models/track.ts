import { createHash } from 'node:crypto'
import { and, count, eq, gte } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { modelCache, modelCalls } from '../db/schema.ts'
import { log } from '../log.ts'
import { dhakaDayStart } from '../tools/text.ts'
import { ModelError } from './http.ts'

export function hashOf(...parts: (string | Buffer)[]): string {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest('hex')
}

export class ModelLimitError extends ModelError {
  constructor(
    readonly limit: number,
    readonly first: boolean,
  ) {
    super(`daily model call limit of ${limit} reached`)
  }
}

// Cache hits cost nothing, so only real calls count against the daily budget.
export function dailyLimit(db: Db, limit: number) {
  let noticedDay = 0
  return async () => {
    const day = dhakaDayStart(Date.now())
    const [row] = await db
      .select({ n: count() })
      .from(modelCalls)
      .where(and(gte(modelCalls.createdAt, day), eq(modelCalls.cacheHit, false)))
    if ((row?.n ?? 0) < limit) return
    const first = noticedDay !== day
    noticedDay = day
    throw new ModelLimitError(limit, first)
  }
}

export type Call<T> = {
  purpose: string
  provider: string
  model: string
  cacheKey?: string
  run: () => Promise<{ value: T; inputUnits?: number; outputUnits?: number }>
}

export async function tracked<T>(db: Db, call: Call<T>, guard?: () => Promise<void>): Promise<T> {
  if (call.cacheKey) {
    const [hit] = await db.select().from(modelCache).where(eq(modelCache.key, call.cacheKey))
    if (hit) {
      await record(db, call, { cacheHit: true, latencyMs: 0 })
      return hit.value as T
    }
  }
  await guard?.()
  const started = Date.now()
  try {
    const out = await call.run()
    const latencyMs = Date.now() - started
    await record(db, call, {
      cacheHit: false,
      latencyMs,
      inputUnits: out.inputUnits,
      outputUnits: out.outputUnits,
    })
    if (call.cacheKey && out.value != null) {
      await db
        .insert(modelCache)
        .values({
          key: call.cacheKey,
          purpose: call.purpose,
          value: out.value,
          createdAt: Date.now(),
        })
        .onConflictDoNothing()
    }
    log.debug({ purpose: call.purpose, model: call.model, latencyMs }, 'model call')
    return out.value
  } catch (err) {
    await record(db, call, {
      cacheHit: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 500) : String(err),
    })
    throw err
  }
}

async function record(
  db: Db,
  call: Call<unknown>,
  r: {
    cacheHit: boolean
    latencyMs: number
    inputUnits?: number
    outputUnits?: number
    error?: string
  },
) {
  await db.insert(modelCalls).values({
    id: newId(),
    provider: call.provider,
    model: call.model,
    purpose: call.purpose,
    cacheKey: call.cacheKey ?? null,
    cacheHit: r.cacheHit,
    latencyMs: r.latencyMs,
    inputUnits: r.inputUnits ?? null,
    outputUnits: r.outputUnits ?? null,
    error: r.error ?? null,
    createdAt: Date.now(),
  })
}
