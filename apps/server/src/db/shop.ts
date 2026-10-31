import { eq } from 'drizzle-orm'
import type { Db } from './client.ts'
import { newId } from './ids.ts'
import { shops } from './schema.ts'

const dhakaAreas = [
  'Mirpur',
  'Dhanmondi',
  'Uttara',
  'Gulshan',
  'Banani',
  'Mohammadpur',
  'Badda',
  'Rampura',
  'Motijheel',
  'Farmgate',
  'Bashundhara',
  'Khilgaon',
  'Jatrabari',
  'Tejgaon',
  'Shyamoli',
  'Aftabnagar',
  'Banasree',
  'Malibagh',
  'Moghbazar',
  'Lalbagh',
  'Wari',
  'Mohakhali',
]

// A shop account only. Products, prices, stock and orders come from the connected store.
export async function createShop(
  db: Db,
  input: { slug: string; name?: string; ownerName?: string; area?: string; now?: number },
) {
  const id = newId()
  await db.insert(shops).values({
    id,
    slug: input.slug,
    name: input.name ?? 'My Shop',
    ownerName: input.ownerName ?? 'Owner',
    area: input.area ?? 'Dhaka',
    language: 'bn',
    deliveryRules: { insideDhakaPoisha: 6000, outsideDhakaPoisha: 12000, insideAreas: dhakaAreas },
    paymentMethods: ['cod', 'bkash', 'nagad'],
    bkashNumber: null,
    auto: {},
    feedMuted: false,
    telegramChatId: null,
    linkCode: newId(),
    publicKey: `${newId()}${newId()}`,
    orderSeq: 1000,
    createdAt: input.now ?? Date.now(),
  })
  const [row] = await db.select().from(shops).where(eq(shops.id, id))
  return row!
}
