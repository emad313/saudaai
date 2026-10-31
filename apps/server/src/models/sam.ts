import { decodeMaskToRaster } from '@meta-sam/parser'
import sharp from 'sharp'

const fields = (body: string) =>
  Object.fromEntries(
    body.split(';').map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]),
  )

// SAM 3.1 answers with token text, one record per object: <|box;x1=..;w=..;h=..;c=..|><|mask;..;data=H,W,<marker><base85>|>.
// The mask raster covers the box only, so it is placed back at (x1, y1) on a frame-sized canvas.
export async function bestMask(text: string): Promise<Buffer | null> {
  let best: { box: Record<string, string>; data: string; score: number } | null = null
  for (const m of text.matchAll(/<\|box;([^|]*)\|><\|mask;([^|]*)\|>/g)) {
    const box = fields(m[1]!)
    const score = Number(box.c ?? 0)
    if (!best || score > best.score) best = { box, data: fields(m[2]!).data!, score }
  }
  if (!best) return null

  const [h, w, packed] = best.data.split(',') as [string, string, string]
  const raster = decodeMaskToRaster({
    encoding: packed[0] === '!' ? 'one_bit' : 'lossless',
    payload: packed,
    width: Number(w),
    height: Number(h),
  })
  const width = Number(best.box.w)
  const height = Number(best.box.h)
  const x1 = Number(best.box.x1)
  const y1 = Number(best.box.y1)
  const full = Buffer.alloc(width * height)
  for (let r = 0; r < Number(h) && y1 + r < height; r++) {
    for (let c = 0; c < Number(w) && x1 + c < width; c++) {
      if (raster[r * Number(w) + c]) full[(y1 + r) * width + x1 + c] = 255
    }
  }
  return sharp(full, { raw: { width, height, channels: 1 } })
    .toColourspace('b-w')
    .png()
    .toBuffer()
}
