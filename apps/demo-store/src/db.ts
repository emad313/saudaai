import { createClient, type Client } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Client

export type Variant = {
  id: string
  productId: string
  size: string | null
  color: string | null
  sku: string | null
  pricePoisha: number
  stock: number | null
}

export type Product = {
  id: string
  name: string
  category: string
  description: string
  color: string
  imageUrl: string | null
  status: 'active' | 'draft' | 'archived'
  variants: Variant[]
}

const schema = [
  `create table if not exists products (
    id text primary key, name text not null, category text not null, description text not null,
    color text not null, status text not null, position integer not null)`,
  `create table if not exists variants (
    id text primary key, product_id text not null references products(id), size text, color text,
    sku text, price_poisha integer not null, stock integer, check (stock is null or stock >= 0))`,
  `create table if not exists orders (
    id text primary key, number text not null unique, customer text not null, lines text not null,
    shipping_poisha integer not null, total_poisha integer not null, paid_poisha integer not null default 0,
    status text not null, payment_method text not null, note text, tags text not null, created_at integer not null)`,
]

type Seed = {
  id: string
  name: string
  category: string
  taka: number
  color: string
  description: string
  sizes?: [string, number][]
  colors?: [string, number][]
}

// The same small Bangladeshi fashion catalog the dashboard demo uses, now living in "the seller's own site".
const catalog: Seed[] = [
  {
    id: 'black-tee',
    name: 'Black Cotton T-Shirt',
    category: 't-shirt',
    taka: 450,
    color: '#1f2937',
    description: '100% cotton, 180 GSM, everyday fit.',
    sizes: [
      ['M', 8],
      ['L', 10],
      ['XL', 6],
    ],
  },
  {
    id: 'white-tee',
    name: 'White Cotton T-Shirt',
    category: 't-shirt',
    taka: 450,
    color: '#e5e7eb',
    description: '100% cotton, 180 GSM, everyday fit.',
    sizes: [
      ['M', 5],
      ['L', 7],
      ['XL', 3],
    ],
  },
  {
    id: 'maroon-kurti',
    name: 'Maroon Block Print Kurti',
    category: 'kurti',
    taka: 1250,
    color: '#7f1d1d',
    description: 'Hand block print on soft cotton, three-quarter sleeves.',
    sizes: [
      ['M', 4],
      ['L', 4],
      ['XL', 4],
    ],
  },
  {
    id: 'navy-kurti',
    name: 'Navy Embroidered Kurti',
    category: 'kurti',
    taka: 1450,
    color: '#1e3a8a',
    description: 'Thread embroidery on the yoke, cotton blend.',
    sizes: [
      ['M', 3],
      ['L', 3],
      ['XL', 2],
    ],
  },
  {
    id: 'peach-threepiece',
    name: 'Peach Georgette Three-Piece',
    category: 'three-piece',
    taka: 2450,
    color: '#fdba74',
    description: 'Georgette kameez, dupatta and salwar, unstitched.',
    sizes: [
      ['M', 3],
      ['L', 3],
    ],
  },
  {
    id: 'green-threepiece',
    name: 'Green Cotton Three-Piece',
    category: 'three-piece',
    taka: 1850,
    color: '#166534',
    description: 'Printed cotton set for summer.',
    sizes: [
      ['M', 5],
      ['L', 4],
      ['XL', 3],
    ],
  },
  {
    id: 'jersey-hijab',
    name: 'Jersey Hijab',
    category: 'hijab',
    taka: 350,
    color: '#111827',
    description: 'Stretchy jersey, no pins needed.',
    colors: [
      ['black', 12],
      ['maroon', 10],
      ['cream', 6],
    ],
  },
  {
    id: 'chiffon-hijab',
    name: 'Chiffon Hijab',
    category: 'hijab',
    taka: 400,
    color: '#f9a8d4',
    description: 'Light chiffon with a soft drape.',
    colors: [
      ['black', 9],
      ['pink', 4],
      ['olive', 5],
    ],
  },
  {
    id: 'leather-bag',
    name: 'Brown Leather Hand Bag',
    category: 'bag',
    taka: 1650,
    color: '#78350f',
    description: 'Genuine leather, two inner pockets.',
    colors: [['brown', 3]],
  },
  {
    id: 'tote-bag',
    name: 'Canvas Tote Bag',
    category: 'bag',
    taka: 650,
    color: '#d6d3d1',
    description: 'Heavy canvas, fits a laptop.',
    colors: [
      ['beige', 5],
      ['black', 5],
    ],
  },
  {
    id: 'kids-frock',
    name: 'Kids Cotton Frock',
    category: 'frock',
    taka: 850,
    color: '#facc15',
    description: 'Soft cotton with a gathered skirt.',
    sizes: [
      ['2-3y', 4],
      ['4-5y', 3],
      ['6-7y', 3],
    ],
  },
  {
    id: 'printed-scarf',
    name: 'Printed Cotton Scarf',
    category: 'scarf',
    taka: 300,
    color: '#0f766e',
    description: 'Block printed cotton scarf, one size.',
    colors: [['multicolor', 12]],
  },
]

export async function openDb(url: string) {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true })
  const db = createClient({ url })
  for (const sql of schema) await db.execute(sql)
  const { rows: cols } = await db.execute('pragma table_info(products)')
  if (!cols.some((c) => c.name === 'image_url')) {
    await db.execute('alter table products add column image_url text')
  }
  const { rows } = await db.execute('select count(*) as n from products')
  if (Number(rows[0]!.n) === 0) await seed(db)
  return db
}

async function seed(db: Db) {
  const stmts = catalog.flatMap((p, position) => [
    {
      sql: 'insert into products (id, name, category, description, color, status, position) values (?, ?, ?, ?, ?, ?, ?)',
      args: [p.id, p.name, p.category, p.description, p.color, 'active', position],
    },
    ...(p.sizes ?? []).map(([size, stock]) => ({
      sql: 'insert into variants values (?, ?, ?, ?, ?, ?, ?)',
      args: [
        `${p.id}-${size.toLowerCase()}`,
        p.id,
        size,
        null,
        `${p.id}-${size}`.toUpperCase(),
        p.taka * 100,
        stock,
      ],
    })),
    ...(p.colors ?? []).map(([color, stock]) => ({
      sql: 'insert into variants values (?, ?, ?, ?, ?, ?, ?)',
      args: [
        `${p.id}-${color}`,
        p.id,
        null,
        color,
        `${p.id}-${color}`.toUpperCase(),
        p.taka * 100,
        stock,
      ],
    })),
  ])
  await db.batch(stmts, 'write')
}

export async function loadProducts(db: Db, where = '1 = 1', args: (string | number)[] = []) {
  const products = await db.execute({
    sql: `select * from products where ${where} order by position`,
    args,
  })
  if (!products.rows.length) return []
  const ids = products.rows.map((r) => String(r.id))
  const variants = await db.execute({
    sql: `select * from variants where product_id in (${ids.map(() => '?').join(',')}) order by rowid`,
    args: ids,
  })
  return products.rows.map((r): Product => ({
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    description: String(r.description),
    color: String(r.color),
    imageUrl: r.image_url ? String(r.image_url) : null,
    status: String(r.status) as Product['status'],
    variants: variants.rows
      .filter((v) => v.product_id === r.id)
      .map((v) => ({
        id: String(v.id),
        productId: String(v.product_id),
        size: v.size === null ? null : String(v.size),
        color: v.color === null ? null : String(v.color),
        sku: v.sku === null ? null : String(v.sku),
        pricePoisha: Number(v.price_poisha),
        stock: v.stock === null ? null : Number(v.stock),
      })),
  }))
}
