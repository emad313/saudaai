import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { media } from '../db/schema.ts'
import { env } from '../env.ts'

export type Media = typeof media.$inferSelect

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
}

export async function saveMedia(
  db: Db,
  bytes: Buffer,
  mime: string,
  extra: { durationMs?: number } = {},
): Promise<Media> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const [existing] = await db.select().from(media).where(eq(media.sha256, sha256))
  if (existing) return existing
  const type = mime.split(';')[0]!.trim()
  const dir = resolve(env.MEDIA_DIR)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sha256}.${extensions[type] ?? 'bin'}`)
  await writeFile(path, bytes)
  const size = type.startsWith('image/') ? await sharp(bytes).metadata() : undefined
  const row: Media = {
    id: newId(),
    sha256,
    mime: type,
    path,
    width: size?.width ?? null,
    height: size?.height ?? null,
    durationMs: extra.durationMs ?? null,
    createdAt: Date.now(),
  }
  await db.insert(media).values(row).onConflictDoNothing()
  const [saved] = await db.select().from(media).where(eq(media.sha256, sha256))
  return saved!
}

export async function loadMedia(db: Db, id: string) {
  const [row] = await db.select().from(media).where(eq(media.id, id))
  if (!row) return null
  return { row, bytes: await readFile(row.path) }
}

export function mediaUrl(id: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/media/${id}`
}
