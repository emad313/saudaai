import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { Db } from '../db/client.ts'
import { media, products } from '../db/schema.ts'
import { log } from '../log.ts'
import { saveMedia, type Media } from '../media/store.ts'

type Product = typeof products.$inferSelect

const maxBytes = 8 * 1024 * 1024

// Store products only carry the store's image URL; fetch it once so every channel can send it.
export async function productImage(db: Db, p: Product): Promise<Media | null> {
  if (p.imageId) {
    const [row] = await db.select().from(media).where(eq(media.id, p.imageId))
    if (row) return row
  }
  if (!p.imageUrl) return null
  try {
    const res = await fetch(p.imageUrl, { signal: AbortSignal.timeout(15_000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error(`${bytes.length} bytes`)
    // Re-encode so channels that only take jpeg/png (and our renderer) get a normal image.
    const jpeg = await sharp(bytes).rotate().jpeg({ quality: 88 }).toBuffer()
    const saved = await saveMedia(db, jpeg, 'image/jpeg', { role: 'catalog' })
    await db.update(products).set({ imageId: saved.id }).where(eq(products.id, p.id))
    return saved
  } catch (err) {
    log.warn(
      { productId: p.id, err: err instanceof Error ? err.message : err },
      'store image failed',
    )
    return null
  }
}

export const hasImage = (p: Pick<Product, 'imageId' | 'imageUrl'>) =>
  Boolean(p.imageId || p.imageUrl)
