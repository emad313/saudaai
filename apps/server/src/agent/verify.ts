import { sumPoisha } from '@saudaai/shared'
import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { orderLines, orders, payments } from '../db/schema.ts'

export async function verifyOrders(db: Db, orderIds: string[]): Promise<string[]> {
  if (!orderIds.length) return []
  const problems: string[] = []
  const rows = await db.select().from(orders).where(inArray(orders.id, orderIds))
  for (const o of rows) {
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, o.id))
    const paid = await db.select().from(payments).where(eq(payments.orderId, o.id))
    const subtotal = sumPoisha(lines.map((l) => l.qty * l.unitPricePoisha))
    if (lines.some((l) => l.lineTotalPoisha !== l.qty * l.unitPricePoisha)) {
      problems.push(`order #${o.number}: a line total does not match qty x price`)
    }
    if (o.subtotalPoisha !== subtotal || o.totalPoisha !== subtotal + o.deliveryPoisha) {
      problems.push(`order #${o.number}: total does not match its lines`)
    }
    if (o.paidPoisha !== sumPoisha(paid.map((p) => p.amountPoisha))) {
      problems.push(`order #${o.number}: paid amount does not match payments`)
    }
  }
  return problems
}

const banglaDigits = '০১২৩৪৫৬৭৮৯'

export function numbersIn(text: string): string[] {
  const latin = text.replace(/[০-৯]/g, (d) => String(banglaDigits.indexOf(d)))
  return (latin.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''))
    .filter((n) => Number(n) >= 10)
}

const offerWords =
  /(discount|ডিসকাউন্ট|ছাড়|ছাড়|chhar|char\b|off\b|অফ|free|ফ্রি|refund|রিফান্ড|ফেরত)/i

function latin(text: string) {
  return text.replace(/[০-৯]/g, (d) => String(banglaDigits.indexOf(d)))
}

function priceNumbers(text: string): string[] {
  const t = latin(text)
  const before = [...t.matchAll(/(?:৳|tk\.?|taka|টাকা)\s*(\d[\d,]*)/gi)].map((m) => m[1]!)
  const after = [...t.matchAll(/(\d[\d,]*)\s*(?:৳|tk\b|taka|টাকা|\/-)/gi)].map((m) => m[1]!)
  return [...before, ...after].map((n) => n.replace(/,/g, ''))
}

// A customer reply goes out without the seller only if every number in it was seen in shop data
// or in what the customer wrote, every price in it came from shop data, and it promises no offer.
export function checkCustomerReply(
  text: string,
  facts: Set<string>,
  said: Set<string>,
): string | null {
  if (/\d+\s*%/.test(latin(text)) || (offerWords.test(text) && /\d/.test(latin(text)))) {
    return 'mentions an offer'
  }
  const unknown = numbersIn(text).filter((n) => !facts.has(n) && !said.has(n))
  const prices = priceNumbers(text).filter((n) => !facts.has(n))
  const bad = [...new Set([...unknown, ...prices])]
  return bad.length ? `numbers not from shop data: ${bad.join(', ')}` : null
}
