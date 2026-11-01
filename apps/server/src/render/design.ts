import type { AdFormat } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { loadMedia, saveMedia, type Media } from '../media/store.ts'
import type { ImageSize, Models } from '../models/index.ts'
import { ToolError, type Shop } from '../tools/ctx.ts'
import { esc, screenshot } from './browser.ts'

const sizes: Record<AdFormat, { width: number; height: number; model: ImageSize }> = {
  square: { width: 1080, height: 1080, model: '1024x1024' },
  story: { width: 1080, height: 1920, model: '1024x1792' },
  banner: { width: 1920, height: 640, model: '1792x1024' },
}

export type DesignInput = {
  prompt: string
  refs: string[]
  format: AdFormat
  headline?: string
  text?: string
}

function overlay(shop: Shop, bg: string, s: { width: number; height: number }, d: DesignInput) {
  const words = d.headline || d.text
  const scale = s.width / 1080
  const caption = words
    ? `<div style="position:absolute;left:0;right:0;bottom:0;padding:${120 * scale}px ${70 * scale}px ${60 * scale}px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.72) 100%);color:#fff">
      ${d.headline ? `<div style="font-size:${78 * scale}px;font-weight:700;line-height:1.15">${esc(d.headline)}</div>` : ''}
      ${d.text ? `<div style="font-size:${40 * scale}px;margin-top:${14 * scale}px;line-height:1.3">${esc(d.text)}</div>` : ''}
      <div style="font-size:${28 * scale}px;margin-top:${22 * scale}px;opacity:.85">${esc(shop.name)}</div></div>`
    : ''
  return `<div style="width:${s.width}px;height:${s.height}px;background:url(${bg}) center/cover;position:relative;overflow:hidden">${caption}</div>`
}

// The model draws the picture; words are laid over by Playwright because it cannot write Bangla.
export async function renderDesign(
  db: Db,
  models: Models,
  shop: Shop,
  d: DesignInput,
): Promise<Media> {
  const refs: Buffer[] = []
  for (const id of d.refs) {
    const file = await loadMedia(db, id)
    if (!file) throw new ToolError('not_found', `image ${id} not found`)
    refs.push(file.bytes)
  }
  const s = sizes[d.format]
  const scene = await models.image(
    `${d.prompt}. No text, no letters, no words, no logos, no watermark.`,
    s.model,
    refs,
  )
  const png = await screenshot(
    overlay(shop, `data:image/webp;base64,${scene.toString('base64')}`, s, d),
    { width: s.width, height: s.height },
  )
  return saveMedia(db, png, 'image/png', { role: 'ad', derivedFrom: d.refs[0] })
}
