import sharp from 'sharp'
import type { Deps } from '../agent/deps.ts'
import { log } from '../log.ts'
import { saveMedia, type Media } from '../media/store.ts'
import type { ProductAttributes } from '../models/index.ts'

const canvas = 1080

async function compose(photo: Buffer, mask: Buffer | null) {
  const oriented = await sharp(photo).rotate().toBuffer()
  const base = sharp(oriented)
  const { width = canvas, height = canvas } = await base.metadata()
  let subject: Buffer
  if (mask) {
    const alpha = await sharp(mask)
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .toColourspace('b-w')
      .raw()
      .toBuffer()
    subject = await base
      .clone()
      .removeAlpha()
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer()
    subject = await sharp(subject).trim({ threshold: 1 }).toBuffer()
  } else {
    subject = await base.clone().png().toBuffer()
  }
  const fitted = await sharp(subject)
    .resize(Math.round(canvas * 0.86), Math.round(canvas * 0.86), {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer()
  const catalog = await sharp({
    create: { width: canvas, height: canvas, channels: 3, background: '#f4f1ec' },
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .jpeg({ quality: 88 })
    .toBuffer()
  return { catalog, cutout: mask ? await sharp(subject).png().toBuffer() : null }
}

export type PhotoResult = {
  original: Media
  cutout: Media
  segmented: boolean
  attributes: ProductAttributes | null
}

export async function processProductPhoto(
  deps: Deps,
  photo: Buffer,
  caption: string,
): Promise<PhotoResult> {
  const original = await saveMedia(deps.db, photo, 'image/jpeg')
  const attributes = await deps.models.describe(photo, caption).catch((err: Error) => {
    log.warn({ err: err.message }, 'vision describe failed')
    return null
  })
  const prompt = attributes?.category ?? 'product'
  // SAM and vision run on the same photo but SAM needs the category as its text prompt.
  const mask = await deps.models.segment(photo, prompt).catch((err: Error) => {
    log.warn({ err: err.message }, 'segmentation failed, using the full photo')
    return null
  })
  const images = await compose(photo, mask)
  const catalog = await saveMedia(deps.db, images.catalog, 'image/jpeg', {
    role: 'catalog',
    derivedFrom: original.id,
  })
  if (images.cutout) {
    await saveMedia(deps.db, images.cutout, 'image/png', {
      role: 'cutout',
      derivedFrom: catalog.id,
    })
  }
  return { original, cutout: catalog, segmented: mask !== null, attributes }
}

export function photoNote(r: PhotoResult, caption: string) {
  const a = r.attributes
  const seen = a
    ? `looks like: ${[a.colors.join('/'), a.pattern, a.material, a.category].filter(Boolean).join(' ')}; suggested name "${a.nameSuggestion}"; aliases ${JSON.stringify(a.aliases)}`
    : 'could not read the photo'
  return `[sent a product photo, cleaned image mediaId=${r.cutout.id}; ${seen}] ${caption}`.trim()
}

export async function describeCustomerPhoto(deps: Deps, photo: Buffer, caption: string) {
  const a = await deps.models.describe(photo, caption).catch(() => null)
  return a
    ? `[sent a photo that looks like: ${[a.colors.join('/'), a.pattern, a.category].filter(Boolean).join(' ')}] ${caption}`.trim()
    : `[sent a photo] ${caption}`.trim()
}
