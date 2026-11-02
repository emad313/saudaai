import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { media, mediaBlobs } from '../db/schema.ts'
import { env } from '../env.ts'

export type Media = typeof media.$inferSelect

// With the database off the machine (Turso), the local disk is only a cache: free hosts wipe it.
const diskIsCache = () => !env.DATABASE_URL.startsWith('file:')

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
  extra: { durationMs?: number; role?: Media['role']; derivedFrom?: string } = {},
): Promise<Media> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const [existing] = await db.select().from(media).where(eq(media.sha256, sha256))
  if (existing) return existing
  const type = mime.split(';')[0]!.trim()
  const dir = resolve(env.MEDIA_DIR)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sha256}.${extensions[type] ?? 'bin'}`)
  await writeFile(path, bytes)
  if (diskIsCache()) await db.insert(mediaBlobs).values({ sha256, bytes }).onConflictDoNothing()
  const size = type.startsWith('image/') ? await sharp(bytes).metadata() : undefined
  const row: Media = {
    id: newId(),
    sha256,
    mime: type,
    path,
    width: size?.width ?? null,
    height: size?.height ?? null,
    durationMs: extra.durationMs ?? null,
    role: extra.role ?? 'upload',
    derivedFrom: extra.derivedFrom ?? null,
    createdAt: Date.now(),
  }
  await db.insert(media).values(row).onConflictDoNothing()
  const [saved] = await db.select().from(media).where(eq(media.sha256, sha256))
  return saved!
}

export async function loadMedia(db: Db, id: string) {
  const [row] = await db.select().from(media).where(eq(media.id, id))
  if (!row) return null
  const bytes = await readFile(row.path).catch(async () => {
    const [copy] = await db.select().from(mediaBlobs).where(eq(mediaBlobs.sha256, row.sha256))
    if (!copy) return null
    await mkdir(dirname(row.path), { recursive: true })
    await writeFile(row.path, copy.bytes)
    return copy.bytes
  })
  return bytes ? { row, bytes } : null
}

export async function derived(db: Db, id: string, role: Media['role']) {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.derivedFrom, id), eq(media.role, role)))
  return row ?? null
}

export function mediaUrl(id: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/media/${id}`
}

export const fileName = (id: string, mime: string) =>
  `${id}.${mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'}`
