import { formatTaka } from '@saudaai/shared'
import type { Ctx, Shop } from './ctx.ts'
import { normalize } from './text.ts'

export function deliveryFor(shop: Shop, area: string) {
  const rules = shop.deliveryRules
  const place = normalize(area)
  const inside =
    place.includes('dhaka') ||
    place.includes('ঢাকা') ||
    rules.insideAreas.some((a) => place.includes(normalize(a)))
  return { inside, poisha: inside ? rules.insideDhakaPoisha : rules.outsideDhakaPoisha }
}

export function getDeliveryRules(ctx: Ctx) {
  const rules = ctx.shop.deliveryRules
  return {
    insideDhaka: formatTaka(rules.insideDhakaPoisha),
    outsideDhaka: formatTaka(rules.outsideDhakaPoisha),
    insideAreas: rules.insideAreas,
    paymentMethods: ctx.shop.paymentMethods,
    bkashNumber: ctx.shop.bkashNumber,
    deliveryTime: { insideDhaka: '1-2 days', outsideDhaka: '3-5 days' },
  }
}
