import { eq } from 'drizzle-orm'
import { createCustomer } from '../tools/customers.ts'
import type { Ctx } from '../tools/ctx.ts'
import { createOrder, recordPayment, updateOrderStatus } from '../tools/orders.ts'
import { createProductDraft, setProductStatus, type VariantInput } from '../tools/products.ts'
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

const sizes = (list: string[], stock: number[], color?: string): VariantInput[] =>
  list.map((size, i) => ({ size, stock: stock[i] ?? 0, ...(color ? { color } : {}) }))

const colors = (list: string[], stock: number[]): VariantInput[] =>
  list.map((color, i) => ({ color, stock: stock[i] ?? 0 }))

const catalog = [
  {
    name: 'Black Cotton T-Shirt',
    category: 't-shirt',
    taka: 450,
    aliases: [
      'kalo t-shirt',
      'kalo tshirt',
      'kalo genji',
      'black tshirt',
      'কালো টি-শার্ট',
      'কালো গেঞ্জি',
    ],
    variants: sizes(['M', 'L', 'XL'], [8, 10, 6], 'black'),
  },
  {
    name: 'White Cotton T-Shirt',
    category: 't-shirt',
    taka: 450,
    aliases: ['sada t-shirt', 'sada tshirt', 'white tshirt', 'সাদা টি-শার্ট', 'সাদা গেঞ্জি'],
    variants: sizes(['M', 'L', 'XL'], [6, 7, 3], 'white'),
  },
  {
    name: 'Maroon Block Print Kurti',
    category: 'kurti',
    taka: 1250,
    aliases: ['maroon kurti', 'block print kurti', 'মেরুন কুর্তি', 'ব্লক প্রিন্ট কুর্তি'],
    variants: sizes(['M', 'L', 'XL'], [5, 5, 4], 'maroon'),
  },
  {
    name: 'Navy Embroidered Kurti',
    category: 'kurti',
    taka: 1450,
    aliases: ['navy kurti', 'nil kurti', 'embroidery kurti', 'নেভি কুর্তি', 'নীল কুর্তি'],
    variants: sizes(['M', 'L', 'XL'], [3, 4, 2], 'navy'),
  },
  {
    name: 'Peach Georgette Three-Piece',
    category: 'three-piece',
    taka: 2450,
    aliases: [
      'three piece',
      'peach three piece',
      'georgette three piece',
      'থ্রি পিস',
      'জর্জেট থ্রি পিস',
    ],
    variants: sizes(['M', 'L'], [4, 3], 'peach'),
  },
  {
    name: 'Green Cotton Three-Piece',
    category: 'three-piece',
    taka: 1850,
    aliases: ['sobuj three piece', 'green three piece', 'cotton three piece', 'সবুজ থ্রি পিস'],
    variants: sizes(['M', 'L', 'XL'], [5, 5, 3], 'green'),
  },
  {
    name: 'Jersey Hijab',
    category: 'hijab',
    taka: 350,
    aliases: ['hijab', 'jersey hijab', 'হিজাব', 'জার্সি হিজাব'],
    variants: colors(['black', 'maroon', 'cream'], [15, 10, 8]),
  },
  {
    name: 'Chiffon Hijab',
    category: 'hijab',
    taka: 400,
    aliases: ['chiffon hijab', 'শিফন হিজাব'],
    variants: colors(['black', 'pink', 'olive'], [9, 6, 5]),
  },
  {
    name: 'Brown Leather Hand Bag',
    category: 'bag',
    taka: 1650,
    aliases: ['hand bag', 'handbag', 'leather bag', 'ব্যাগ', 'হ্যান্ড ব্যাগ'],
    variants: colors(['brown'], [4]),
  },
  {
    name: 'Canvas Tote Bag',
    category: 'bag',
    taka: 650,
    aliases: ['tote bag', 'tote', 'canvas bag', 'টোট ব্যাগ'],
    variants: colors(['beige', 'black'], [7, 5]),
  },
  {
    name: 'Kids Cotton Frock',
    category: 'frock',
    taka: 850,
    aliases: ['frock', 'baccha frock', 'kids dress', 'ফ্রক', 'বাচ্চাদের ফ্রক'],
    variants: sizes(['2-3y', '4-5y', '6-7y'], [4, 5, 3], 'yellow'),
  },
  {
    name: 'Printed Cotton Scarf',
    category: 'scarf',
    taka: 300,
    aliases: ['scarf', 'orna', 'ওড়না', 'স্কার্ফ'],
    variants: colors(['multicolor'], [12]),
  },
]

const people = [
  {
    name: 'Rahim Uddin',
    phone: '01711000101',
    area: 'Mirpur 10',
    address: 'House 12, Road 3, Mirpur 10, Dhaka',
  },
  {
    name: 'Karim Hossain',
    phone: '01811000202',
    area: 'Chattogram',
    address: 'Agrabad C/A, Chattogram',
  },
  {
    name: 'Sumaiya Akter',
    phone: '01911000303',
    area: 'Dhanmondi',
    address: 'Road 27, Dhanmondi, Dhaka',
  },
  {
    name: 'Farhana Rahman',
    phone: '01611000404',
    area: 'Uttara',
    address: 'Sector 7, Uttara, Dhaka',
  },
  { name: 'Tanvir Ahmed', phone: '01511000505', area: 'Sylhet', address: 'Zindabazar, Sylhet' },
  {
    name: 'Nasrin Sultana',
    phone: '01311000606',
    area: 'Mohammadpur',
    address: 'Tajmahal Road, Mohammadpur, Dhaka',
  },
  { name: 'Jamil Khan', phone: '01411000707', area: 'Gulshan', address: 'Gulshan 1, Dhaka' },
  { name: 'Rupa Das', phone: '01711000808', area: 'Khulna', address: 'Sonadanga, Khulna' },
]

const hour = 60 * 60 * 1000

// [customer, product, variant, qty, method, hoursAgo, final status, paid]
const history: [number, number, number, number, string, number, string, boolean][] = [
  [0, 0, 1, 2, 'bkash', 150, 'delivered', true],
  [1, 2, 0, 1, 'bkash', 140, 'delivered', true],
  [2, 6, 0, 3, 'cod', 130, 'delivered', true],
  [3, 4, 0, 1, 'nagad', 120, 'delivered', true],
  [4, 5, 1, 1, 'bkash', 100, 'shipped', true],
  [5, 9, 0, 2, 'cod', 90, 'delivered', false],
  [6, 8, 0, 1, 'bkash', 80, 'delivered', true],
  [7, 10, 1, 2, 'cod', 72, 'shipped', false],
  [0, 7, 1, 2, 'bkash', 60, 'confirmed', false],
  [2, 3, 1, 1, 'bkash', 50, 'shipped', true],
  [3, 11, 0, 2, 'cod', 40, 'cancelled', false],
  [1, 0, 2, 1, 'nagad', 30, 'confirmed', false],
  [5, 2, 1, 1, 'bkash', 20, 'confirmed', true],
  [6, 6, 2, 2, 'cod', 6, 'confirmed', false],
  [4, 1, 0, 1, 'bkash', 3, 'draft', false],
]

const paths: Record<string, string[]> = {
  draft: [],
  confirmed: ['confirmed'],
  shipped: ['confirmed', 'shipped'],
  delivered: ['confirmed', 'shipped', 'delivered'],
  cancelled: ['cancelled'],
}

export async function seedDemoShop(db: Db, now = Date.now(), slug = 'nusrats-closet') {
  const shop = {
    id: newId(),
    slug,
    name: "Nusrat's Closet",
    ownerName: 'Nusrat',
    area: 'Mirpur, Dhaka',
    language: 'bn',
    deliveryRules: { insideDhakaPoisha: 6000, outsideDhakaPoisha: 12000, insideAreas: dhakaAreas },
    paymentMethods: ['cod', 'bkash', 'nagad'],
    bkashNumber: '01700000000',
    auto: {},
    feedMuted: false,
    telegramChatId: null,
    linkCode: newId(),
    orderSeq: 1000,
    createdAt: now - 30 * 24 * hour,
  }
  await db.insert(shops).values(shop)
  const ctx = (at: number): Ctx => ({ db, shop: { ...shop }, actor: 'system', now: at })

  const items = []
  for (const p of catalog) {
    const made = await createProductDraft(ctx(shop.createdAt), {
      name: p.name,
      category: p.category,
      pricePoisha: p.taka * 100,
      aliases: p.aliases,
      variants: p.variants,
    })
    await setProductStatus(ctx(shop.createdAt), { productId: made.productId, status: 'active' })
    items.push(made)
  }

  const buyers = []
  for (const person of people) buyers.push(await createCustomer(ctx(shop.createdAt), person))

  for (const [ci, pi, vi, qty, method, ago, status, paid] of history) {
    const at = now - ago * hour
    const buyer = buyers[ci]!
    const order = await createOrder(ctx(at), {
      customerId: buyer.customerId,
      lines: [{ variantId: items[pi]!.variants[vi]!.variantId, qty }],
      deliveryArea: buyer.area ?? '',
      paymentMethod: method,
      source: 'seller_voice',
    })
    for (const step of paths[status]!) {
      await updateOrderStatus(ctx(at + hour), {
        orderId: order.orderId,
        status: step as 'confirmed',
      })
    }
    if (paid) {
      await recordPayment(ctx(at + 2 * hour), {
        orderId: order.orderId,
        amountPoisha: order.totalPoisha,
        method,
      })
    }
  }

  const [row] = await db.select().from(shops).where(eq(shops.id, shop.id))
  return row!
}
