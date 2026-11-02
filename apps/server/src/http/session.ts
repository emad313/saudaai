import { and, eq, gt } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { loginCodes, sessions, shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Shop } from '../tools/ctx.ts'

export type SellerEnv = { Variables: { shop: Shop; demo: boolean } }

const cookie = 'sid'
const month = 30 * 24 * 60 * 60 * 1000
const day = 24 * 60 * 60 * 1000

async function start(c: Context, db: Db, shopId: string, demo: boolean) {
  const now = Date.now()
  const ttl = demo ? day : month
  const id = `${newId()}${newId()}`
  await db.insert(sessions).values({ id, shopId, demo, expiresAt: now + ttl, createdAt: now })
  setCookie(c, cookie, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttl / 1000,
  })
}

export async function login(c: Context, db: Db, code: string) {
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.code, code), gt(loginCodes.expiresAt, Date.now())))
  if (!row) throw new HTTPException(401, { message: 'code is wrong or expired' })
  await db.delete(loginCodes).where(eq(loginCodes.code, code))
  await start(c, db, row.shopId, false)
}

export async function demoShop(db: Db) {
  if (!env.DEMO_LOGIN) return null
  const [shop] = await db.select().from(shops).where(eq(shops.slug, env.DEMO_SHOP_SLUG))
  return shop ?? null
}

// Judges sign in with one click and can use everything except what would break the demo.
export async function demoLogin(c: Context, db: Db) {
  const shop = await demoShop(db)
  if (!shop) throw new HTTPException(404, { message: 'there is no demo here' })
  await start(c, db, shop.id, true)
}

export function noDemo(c: Context<SellerEnv>) {
  if (c.get('demo')) {
    throw new HTTPException(403, { message: 'the demo keeps its store and settings as they are' })
  }
}

export async function logout(c: Context, db: Db) {
  const id = getCookie(c, cookie)
  if (id) await db.delete(sessions).where(eq(sessions.id, id))
  deleteCookie(c, cookie, { path: '/' })
}

export function requireShop(db: Db): MiddlewareHandler<SellerEnv> {
  return async (c, next) => {
    const id = getCookie(c, cookie)
    const [row] = id
      ? await db
          .select({ shop: shops, demo: sessions.demo })
          .from(sessions)
          .innerJoin(shops, eq(shops.id, sessions.shopId))
          .where(and(eq(sessions.id, id), gt(sessions.expiresAt, Date.now())))
      : []
    if (row) {
      c.set('shop', row.shop)
      c.set('demo', row.demo)
      return next()
    }
    throw new HTTPException(401, { message: 'log in with the code from the telegram bot' })
  }
}
