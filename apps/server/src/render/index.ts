import type { Renderer } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import type { Models } from '../models/index.ts'
import { renderAds } from './ad.ts'
import { renderInvoice } from './invoice.ts'

export function createRenderer(db: Db, models: Models): Renderer {
  return {
    invoice: (shop, orderId) => renderInvoice(db, shop, orderId),
    ad: (shop, input) => renderAds(db, models, shop, input),
  }
}
