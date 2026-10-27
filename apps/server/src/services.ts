import type { Deps } from './agent/deps.ts'
import { createOutbound } from './channels/outbound.ts'
import { createTelegram } from './channels/telegram.ts'
import { migrateDb, openDb } from './db/client.ts'
import { env } from './env.ts'
import { createInbox } from './inbox.ts'
import { createModels } from './models/index.ts'
import { createRenderer } from './render/index.ts'

export async function createServices() {
  const db = openDb(env.DATABASE_URL)
  await migrateDb(db)
  const models = createModels(db, env)
  const telegram = createTelegram(db)
  const deps: Deps = {
    db,
    models,
    seller: telegram.seller,
    outbound: createOutbound(db),
    render: createRenderer(db, models),
    now: Date.now,
  }
  const inbox = createInbox(deps, {
    transcript: (shop, text) => telegram.seller.notify(shop, `🎙 ${text}`),
  })
  telegram.wire(deps, inbox)
  return { db, deps, inbox, telegram }
}

export type Services = Awaited<ReturnType<typeof createServices>>
