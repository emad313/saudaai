import { createHmac, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { loadProducts, type Db, type Product } from './db.ts'
import { adminPage, messagePage, productPage, shopPage } from './site.ts'

export { openDb } from './db.ts'

export type StoreConfig = {
  token: string
  saudaai?: { url: string; shopId: string; webhookSecret: string; publicKey?: string }
  pageSize?: number
}

const orderInput = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    area: z.string().optional(),
  }),
  lines: z
    .array(z.object({ variantExternalId: z.string(), qty: z.number().int().positive() }))
    .min(1),
  shippingPoisha: z.number().int().min(0),
  paymentMethod: z.string(),
  note: z.string().optional(),
  tags: z.array(z.string()),
})

const productInput = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(40).optional(),
  description: z.string().max(1000).optional(),
  imageUrl: z.url().optional(),
  status: z.enum(['active', 'draft']).default('draft'),
  variants: z
    .array(
      z.object({
        size: z.string().max(20).optional(),
        color: z.string().max(20).optional(),
        sku: z.string().max(40).optional(),
        pricePoisha: z.number().int().positive(),
        stock: z.number().int().min(0).nullable(),
      }),
    )
    .min(1)
    .max(30),
})

const orderChange = z.object({
  status: z.enum(['confirmed', 'shipped', 'delivered', 'cancelled']).optional(),
  paidPoisha: z.number().int().min(0).optional(),
  note: z.string().optional(),
})

function external(p: Product) {
  return {
    externalId: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    status: p.status,
    variants: p.variants.map((v) => ({
      externalId: v.id,
      ...(v.size ? { size: v.size } : {}),
      ...(v.color ? { color: v.color } : {}),
      ...(v.sku ? { sku: v.sku } : {}),
      pricePoisha: v.pricePoisha,
      stock: v.stock,
    })),
  }
}

export function createStoreApp(db: Db, cfg: StoreConfig) {
  const app = new Hono()
  const pageSize = cfg.pageSize ?? 10

  // Tell SaudaAI what changed so its copy stays current between pulls.
  async function notify(events: unknown[]) {
    if (!cfg.saudaai || !events.length) return
    const raw = JSON.stringify(events)
    const sig = createHmac('sha256', cfg.saudaai.webhookSecret).update(raw).digest('hex')
    await fetch(`${cfg.saudaai.url}/webhooks/store/${cfg.saudaai.shopId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-saudaai-signature': `sha256=${sig}` },
      body: raw,
    }).catch((err: Error) => console.error(`webhook to saudaai failed: ${err.message}`))
  }

  type OrderInput = z.infer<typeof orderInput>

  // Prices come from this site's own catalog; stock is taken in the same transaction.
  async function placeOrder(o: OrderInput) {
    const tx = await db.transaction('write')
    try {
      let items = 0
      const touched: string[] = []
      const lines = []
      for (const l of o.lines) {
        const { rows } = await tx.execute({
          sql: 'select * from variants where id = ?',
          args: [l.variantExternalId],
        })
        const v = rows[0]
        if (!v) throw new Error(`no variant ${l.variantExternalId}`)
        if (v.stock !== null && Number(v.stock) < l.qty)
          throw new Error(`only ${v.stock} left of ${v.id}`)
        if (v.stock !== null) {
          await tx.execute({
            sql: 'update variants set stock = stock - ? where id = ?',
            args: [l.qty, String(v.id)],
          })
          touched.push(String(v.id))
        }
        const unit = Number(v.price_poisha)
        items += unit * l.qty
        lines.push({
          variantExternalId: String(v.id),
          productExternalId: String(v.product_id),
          qty: l.qty,
          unitPricePoisha: unit,
        })
      }
      const { rows: count } = await tx.execute('select count(*) as n from orders')
      const id = randomUUID()
      const number = `NC-${1001 + Number(count[0]!.n)}`
      const total = items + o.shippingPoisha
      await tx.execute({
        sql: 'insert into orders values (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
        args: [
          id,
          number,
          JSON.stringify(o.customer),
          JSON.stringify(lines),
          o.shippingPoisha,
          total,
          'confirmed',
          o.paymentMethod,
          o.note ?? null,
          o.tags.join(','),
          Date.now(),
        ],
      })
      await tx.commit()
      const stock = await db.execute({
        sql: `select id, stock from variants where id in (${touched.map(() => '?').join(',') || "''"})`,
        args: touched,
      })
      void notify(
        stock.rows.map((r) => ({
          type: 'stock',
          variantExternalId: String(r.id),
          stock: Number(r.stock),
        })),
      )
      return { externalId: id, number, totalPoisha: total }
    } catch (err) {
      await tx.rollback()
      throw err
    } finally {
      tx.close()
    }
  }

  function storeOrder(r: Record<string, unknown>) {
    return {
      externalId: String(r.id),
      number: String(r.number),
      status: String(r.status),
      createdAt: Number(r.created_at),
      customer: JSON.parse(String(r.customer)),
      lines: JSON.parse(String(r.lines)),
      shippingPoisha: Number(r.shipping_poisha),
      totalPoisha: Number(r.total_poisha),
      paidPoisha: Number(r.paid_poisha),
      paymentMethod: String(r.payment_method),
    }
  }

  const api = new Hono()
  api.use(async (c, next) => {
    if (c.req.header('authorization') !== `Bearer ${cfg.token}`)
      return c.json({ error: 'bad token' }, 401)
    await next()
  })

  api.get('/info', (c) => c.json({ name: 'SaudaAI Demo Shop', currency: 'BDT' }))

  api.get('/products', async (c) => {
    const after = Number(c.req.query('cursor') ?? -1)
    const rows = await loadProducts(db, 'position > ? and position <= ?', [after, after + pageSize])
    const { rows: last } = await db.execute('select max(position) as n from products')
    const end = after + pageSize
    return c.json({
      products: rows.map(external),
      ...(end < Number(last[0]!.n) ? { next: String(end) } : {}),
    })
  })

  api.get('/products/:id', async (c) => {
    const [p] = await loadProducts(db, 'id = ?', [c.req.param('id')])
    return p ? c.json(external(p)) : c.json({ error: 'not found' }, 404)
  })

  api.post('/products', async (c) => {
    const input = productInput.safeParse(await c.req.json())
    if (!input.success) return c.json({ error: input.error.issues[0]?.message }, 400)
    const p = input.data
    const slug = p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const id = `${slug}-${randomUUID().slice(0, 6)}`
    const { rows } = await db.execute('select coalesce(max(position), -1) + 1 as n from products')
    await db.batch(
      [
        {
          sql: 'insert into products (id, name, category, description, color, status, position, image_url) values (?, ?, ?, ?, ?, ?, ?, ?)',
          args: [
            id,
            p.name,
            p.category ?? 'other',
            p.description ?? '',
            '#cbd5e1',
            p.status,
            Number(rows[0]!.n),
            p.imageUrl ?? null,
          ],
        },
        ...p.variants.map((v, i) => ({
          sql: 'insert into variants values (?, ?, ?, ?, ?, ?, ?)',
          args: [
            `${id}-${i + 1}`,
            id,
            v.size ?? null,
            v.color ?? null,
            v.sku ?? null,
            v.pricePoisha,
            v.stock,
          ],
        })),
      ],
      'write',
    )
    const [made] = await loadProducts(db, 'id = ?', [id])
    return c.json(external(made!), 201)
  })

  api.patch('/products/:id', async (c) => {
    const body = z
      .object({ status: z.enum(['active', 'draft', 'archived']) })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'status must be active, draft or archived' }, 400)
    const res = await db.execute({
      sql: 'update products set status = ? where id = ?',
      args: [body.data.status, c.req.param('id')],
    })
    return res.rowsAffected ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
  })

  api.post('/stock', async (c) => {
    const body = z
      .object({ variantExternalId: z.string(), delta: z.number().int() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'variantExternalId and delta are required' }, 400)
    const { rows } = await db.execute({
      sql: 'select stock from variants where id = ?',
      args: [body.data.variantExternalId],
    })
    if (!rows[0]) return c.json({ error: 'not found' }, 404)
    if (rows[0].stock === null) return c.json({ error: 'stock is not tracked for this item' }, 409)
    const stock = Number(rows[0].stock) + body.data.delta
    if (stock < 0) return c.json({ error: `only ${rows[0].stock} in stock` }, 409)
    await db.execute({
      sql: 'update variants set stock = ? where id = ?',
      args: [stock, body.data.variantExternalId],
    })
    return c.json({ stock })
  })

  api.post('/posts', async (c) => {
    const post = z
      .object({ title: z.string().min(1).max(120), body: z.string().max(2000), imageUrl: z.url() })
      .safeParse(await c.req.json())
    if (!post.success) return c.json({ error: post.error.issues[0]?.message }, 400)
    const id = randomUUID()
    await db.execute({
      sql: 'insert into posts values (?, ?, ?, ?, ?)',
      args: [id, post.data.title, post.data.body, post.data.imageUrl, Date.now()],
    })
    return c.json({ externalId: id, url: `${new URL(c.req.url).origin}/#post-${id}` }, 201)
  })

  api.post('/orders', async (c) => {
    const input = orderInput.safeParse(await c.req.json())
    if (!input.success) return c.json({ error: input.error.issues[0]?.message }, 400)
    try {
      const made = await placeOrder(input.data)
      return c.json({ ...made, adminUrl: `${new URL(c.req.url).origin}/admin#${made.number}` })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409)
    }
  })

  api.get('/orders', async (c) => {
    const since = Number(c.req.query('since') ?? 0)
    const { rows } = await db.execute({
      sql: 'select * from orders where created_at >= ? order by created_at',
      args: [since],
    })
    return c.json({ orders: rows.map(storeOrder) })
  })

  api.get('/orders/:id', async (c) => {
    const { rows } = await db.execute({
      sql: 'select * from orders where id = ?',
      args: [c.req.param('id')],
    })
    return rows[0] ? c.json(storeOrder(rows[0])) : c.json({ error: 'not found' }, 404)
  })

  api.patch('/orders/:id', async (c) => {
    const change = orderChange.safeParse(await c.req.json())
    if (!change.success) return c.json({ error: change.error.issues[0]?.message }, 400)
    const { rows } = await db.execute({
      sql: 'select * from orders where id = ?',
      args: [c.req.param('id')],
    })
    const order = rows[0]
    if (!order) return c.json({ error: 'not found' }, 404)
    const { status, paidPoisha, note } = change.data
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const lines = JSON.parse(String(order.lines)) as { variantExternalId: string; qty: number }[]
      await db.batch(
        lines.map((l) => ({
          sql: 'update variants set stock = stock + ? where id = ? and stock is not null',
          args: [l.qty, l.variantExternalId],
        })),
        'write',
      )
    }
    await db.execute({
      sql: `update orders set status = coalesce(?, status), paid_poisha = coalesce(?, paid_poisha),
        note = case when ? is null then note else trim(coalesce(note, '') || char(10) || ?) end where id = ?`,
      args: [status ?? null, paidPoisha ?? null, note ?? null, note ?? null, String(order.id)],
    })
    return c.json({ ok: true })
  })

  app.route('/saudaai', api)

  const adminKey = (c: Context) => c.req.query('key') === cfg.token

  app.get('/admin', async (c) => {
    if (!adminKey(c)) return c.text('add ?key=<store token>', 401)
    const { rows } = await db.execute(
      'select number, customer, total_poisha, paid_poisha, status, tags from orders order by created_at desc limit 20',
    )
    return c.html(adminPage(await loadProducts(db), rows, cfg.token))
  })

  app.post('/admin/variant', async (c) => {
    if (!adminKey(c)) return c.text('add ?key=<store token>', 401)
    const form = await c.req.parseBody()
    const taka = Number(form.taka)
    const stock = form.stock === '' ? null : Number(form.stock)
    if (
      !Number.isInteger(taka) ||
      taka <= 0 ||
      (stock !== null && (!Number.isInteger(stock) || stock < 0))
    ) {
      return c.text('price must be whole taka and stock a whole number', 400)
    }
    await db.execute({
      sql: 'update variants set price_poisha = ?, stock = ? where id = ?',
      args: [taka * 100, stock, String(form.id)],
    })
    const [p] = await loadProducts(db, 'id = (select product_id from variants where id = ?)', [
      String(form.id),
    ])
    if (p) await notify([{ type: 'product.upsert', product: external(p) }])
    return c.redirect(`/admin?key=${encodeURIComponent(cfg.token)}`)
  })

  const widget = (productId?: string) =>
    cfg.saudaai?.publicKey
      ? { src: `${cfg.saudaai.url}/widget.js`, shop: cfg.saudaai.publicKey, product: productId }
      : null

  // A shopper buying on the site itself, without SaudaAI: the order still reaches SaudaAI by webhook.
  app.post('/checkout', async (c) => {
    const f = await c.req.parseBody()
    const text = (k: string) => String(f[k] ?? '').trim()
    const qty = Number(f.qty)
    if (!text('name') || !text('phone') || !text('address') || !Number.isInteger(qty) || qty < 1) {
      return c.html(messagePage('Please fill in every field.'), 400)
    }
    try {
      const made = await placeOrder({
        customer: {
          name: text('name'),
          phone: text('phone'),
          address: text('address'),
          area: text('area') || undefined,
        },
        lines: [{ variantExternalId: text('variant'), qty }],
        shippingPoisha: f.zone === 'outside' ? 12000 : 6000,
        paymentMethod: f.payment === 'bkash' ? 'bkash' : 'cod',
        tags: ['website'],
      })
      await notify([{ type: 'order.upsert', externalId: made.externalId, status: 'confirmed' }])
      return c.html(
        messagePage(
          `Thank you! Order ${made.number} is placed, total ৳${(made.totalPoisha / 100).toLocaleString('en-IN')}. The shop will call you to confirm.`,
        ),
      )
    } catch (err) {
      return c.html(messagePage(err instanceof Error ? err.message : String(err)), 409)
    }
  })

  app.get('/', async (c) => {
    const { rows } = await db.execute('select * from posts order by created_at desc limit 1')
    const banner = rows[0]
      ? {
          id: String(rows[0].id),
          title: String(rows[0].title),
          body: String(rows[0].body),
          imageUrl: String(rows[0].image_url),
        }
      : null
    return c.html(shopPage(await loadProducts(db, "status = 'active'"), widget(), banner))
  })

  app.get('/p/:id', async (c) => {
    const [p] = await loadProducts(db, "id = ? and status = 'active'", [c.req.param('id')])
    if (!p) return c.notFound()
    return c.html(productPage(p, widget(p.id)))
  })

  return app
}
