import { formatTaka } from '@saudaai/shared'
import type { AdFormat } from '../agent/deps.ts'
import type { Db } from '../db/client.ts'
import { log } from '../log.ts'
import { derived, loadMedia, saveMedia, type Media } from '../media/store.ts'
import type { Models } from '../models/index.ts'
import { ToolError, type Ctx, type Shop } from '../tools/ctx.ts'
import { requireProduct } from '../tools/products.ts'
import { esc, screenshot } from './browser.ts'

const headlines: [RegExp, string][] = [
  [/eid|ঈদ|ইদ/i, 'ঈদ স্পেশাল'],
  [/puja|পূজা|পুজা/i, 'পূজার কালেকশন'],
  [/winter|sheet|শীত/i, 'শীতের কালেকশন'],
  [/boishakh|baishakh|বৈশাখ/i, 'বৈশাখী কালেকশন'],
  [/sale|offer|অফার/i, 'বিশেষ অফার'],
]

export function headlineFor(occasion?: string) {
  return headlines.find(([re]) => occasion && re.test(occasion))?.[1] ?? 'নতুন কালেকশন'
}

export function offerPrice(pricePoisha: number, offerText?: string) {
  const latin = (offerText ?? '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
  const pct = Number(/(\d{1,2})\s*%/.exec(latin)?.[1] ?? 0)
  if (!pct) return null
  return Math.round((pricePoisha * (100 - pct)) / 100 / 100) * 100
}

const sizes: Record<AdFormat, { width: number; height: number; model: '1024x1024' | '1024x1792' }> =
  {
    square: { width: 1080, height: 1080, model: '1024x1024' },
    story: { width: 1080, height: 1920, model: '1024x1792' },
  }

type Parts = {
  shop: Shop
  name: string
  headline: string
  price: string
  was: string | null
  offer?: string
  product: string
  cutout: boolean
  background: string | null
}

function priceBlock(p: Parts, size: number) {
  const was = p.was
    ? `<span style="font-size:${size * 0.55}px;text-decoration:line-through;opacity:.7;margin-right:16px">${esc(p.was)}</span>`
    : ''
  return `<div style="font-size:${size}px;font-weight:700">${was}${esc(p.price)}</div>`
}

function badge(p: Parts) {
  return p.offer
    ? `<div style="display:inline-block;background:#dc2626;color:#fff;font-weight:700;font-size:40px;padding:10px 28px;border-radius:999px;margin-top:22px">${esc(p.offer)}</div>`
    : ''
}

function backdrop(p: Parts) {
  return p.background
    ? `background:url(${p.background}) center/cover`
    : 'background:radial-gradient(circle at 70% 30%,#fdf2e9 0%,#f5d0b5 45%,#b45309 120%)'
}

type Box = [left: number, top: number, width: number, height: number]

// A clean cutout floats over the scene; a plain photo gets a square card so it never looks letterboxed.
function productImg(p: Parts, cutout: Box, framed: Box) {
  const [left, top, width, height] = p.cutout ? cutout : framed
  const look = p.cutout
    ? 'object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.35))'
    : 'object-fit:cover;border-radius:28px;box-shadow:0 30px 60px rgba(0,0,0,.3)'
  return `<img src="${p.product}" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;${look}">`
}

const footer = (p: Parts) =>
  `<div style="font-size:30px;font-weight:600">${esc(p.shop.name)}</div><div style="font-size:26px;opacity:.85">অর্ডার করতে মেসেজ করুন</div>`

const layouts: Record<string, (p: Parts) => string> = {
  side: (
    p,
  ) => `<div style="width:1080px;height:1080px;${backdrop(p)};position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(28,25,23,.78) 0%,rgba(28,25,23,.35) 48%,rgba(0,0,0,0) 70%)"></div>
    ${productImg(p, [490, 90, 560, 860], [500, 230, 520, 520])}
    <div style="position:absolute;left:70px;top:120px;width:480px;color:#fff">
      <div style="font-size:72px;font-weight:700;line-height:1.15">${esc(p.headline)}</div>
      <div style="font-size:40px;margin-top:22px;line-height:1.3">${esc(p.name)}</div>
      <div style="margin-top:30px">${priceBlock(p, 76)}</div>${badge(p)}
    </div>
    <div style="position:absolute;left:70px;bottom:70px;color:#fff">${footer(p)}</div></div>`,
  band: (
    p,
  ) => `<div style="width:1080px;height:1080px;${backdrop(p)};position:relative;overflow:hidden">
    ${productImg(p, [190, 50, 700, 700], [250, 70, 580, 580])}
    <div style="position:absolute;left:0;right:0;bottom:0;height:330px;background:rgba(255,251,245,.94);padding:40px 70px;color:#1c1917;display:flex;justify-content:space-between;align-items:center">
      <div><div style="font-size:30px;color:#b45309;font-weight:700">${esc(p.headline)}</div><div style="font-size:46px;font-weight:700;margin-top:8px;line-height:1.2">${esc(p.name)}</div><div style="margin-top:14px">${footer(p)}</div></div>
      <div style="text-align:right">${priceBlock(p, 70)}${badge(p)}</div>
    </div></div>`,
  story: (
    p,
  ) => `<div style="width:1080px;height:1920px;${backdrop(p)};position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(28,25,23,.7) 0%,rgba(0,0,0,0) 28%,rgba(0,0,0,0) 62%,rgba(28,25,23,.85) 100%)"></div>
    <div style="position:absolute;top:150px;left:0;right:0;text-align:center;color:#fff"><div style="font-size:96px;font-weight:700">${esc(p.headline)}</div></div>
    ${productImg(p, [110, 400, 860, 960], [170, 430, 740, 740])}
    <div style="position:absolute;bottom:170px;left:0;right:0;text-align:center;color:#fff">
      <div style="font-size:52px;line-height:1.25;padding:0 60px">${esc(p.name)}</div>
      <div style="margin-top:24px">${priceBlock(p, 96)}</div>${badge(p)}
      <div style="margin-top:40px">${footer(p)}</div></div></div>`,
}

async function background(models: Models, prompt: string, size: '1024x1024' | '1024x1792') {
  try {
    const png = await models.image(prompt, size)
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'ad background failed, using a gradient',
    )
    return null
  }
}

export async function renderAds(
  db: Db,
  models: Models,
  shop: Shop,
  input: { productId: string; occasion?: string; offerText?: string; formats: AdFormat[] },
): Promise<Media[]> {
  const ctx: Ctx = { db, shop, actor: 'seller', now: Date.now() }
  const p = await requireProduct(ctx, input.productId)
  if (!p.imageId)
    throw new ToolError('no_photo', `${p.name} has no photo yet; send a photo of it first`)
  const cut = await derived(db, p.imageId, 'cutout')
  const file = await loadMedia(db, cut?.id ?? p.imageId)
  if (!file) throw new ToolError('no_photo', `photo for ${p.name} is missing`)
  const sale = offerPrice(p.basePricePoisha, input.offerText)
  const attrs = Object.values(p.attributes).flat().join(' ')
  const prompt = `Product photography background for ${p.category} ${attrs}, ${input.occasion ?? 'new collection'} mood, soft studio light, warm elegant palette, empty space for text, no people, no text, no letters, no logos`
  const parts: Omit<Parts, 'background'> = {
    shop,
    name: p.name,
    headline: headlineFor(input.occasion),
    price: formatTaka(sale ?? p.basePricePoisha),
    was: sale ? formatTaka(p.basePricePoisha) : null,
    offer: input.offerText,
    product: `data:${file.row.mime};base64,${file.bytes.toString('base64')}`,
    cutout: Boolean(cut),
  }
  const jobs = input.formats.flatMap((f): [string, AdFormat][] =>
    f === 'square'
      ? [
          ['side', f],
          ['band', f],
        ]
      : [['story', f]],
  )
  const out: Media[] = []
  for (const [layout, format] of jobs) {
    const s = sizes[format]
    const bg = await background(
      models,
      `${prompt}, ${layout === 'side' ? 'subject space on the right' : 'centered'}`,
      s.model,
    )
    const png = await screenshot(layouts[layout]!({ ...parts, background: bg }), {
      width: s.width,
      height: s.height,
    })
    out.push(await saveMedia(db, png, 'image/png', { role: 'ad', derivedFrom: p.imageId }))
  }
  return out
}
