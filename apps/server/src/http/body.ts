import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'body must be json' })
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new HTTPException(400, {
      message: `${issue?.path.join('.') || 'body'}: ${issue?.message}`,
    })
  }
  return parsed.data
}
