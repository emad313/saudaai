import { and, eq, gt } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { loginCodes, sessions, shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Shop } from '../tools/ctx.ts'

export type SellerEnv = { Variables: { shop: Shop; readonly: boolean } }

const cookie = 'sid'
const month = 30 * 24 * 60 * 60 * 1000

export async function login(c: Context, db: Db, code: string) {
  const now = Date.now()
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.code, code), gt(loginCodes.expiresAt, now)))
  if (!row) throw new HTTPException(401, { message: 'code is wrong or expired' })
  await db.delete(loginCodes).where(eq(loginCodes.code, code))
  const id = `${newId()}${newId()}`
  await db
    .insert(sessions)
    .values({ id, shopId: row.shopId, expiresAt: now + month, createdAt: now })
  setCookie(c, cookie, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: month / 1000,
  })
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
          .select({ shop: shops })
          .from(sessions)
          .innerJoin(shops, eq(shops.id, sessions.shopId))
          .where(and(eq(sessions.id, id), gt(sessions.expiresAt, Date.now())))
      : []
    if (row) {
      c.set('shop', row.shop)
      c.set('readonly', false)
      return next()
    }
    if (env.DEMO_READONLY) {
      const [demo] = await db.select().from(shops).where(eq(shops.slug, env.DEMO_SHOP_SLUG))
      if (demo) {
        if (c.req.method !== 'GET')
          throw new HTTPException(403, { message: 'the public demo is read-only' })
        c.set('shop', demo)
        c.set('readonly', true)
        return next()
      }
    }
    throw new HTTPException(401, { message: 'log in with the code from the telegram bot' })
  }
}
