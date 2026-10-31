import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bestMask } from './sam.ts'

// Real sam-3.1 output for a 40x30 white image with a red 15x12 box at (10, 8), prompt "red rectangle".
const redBox = readFileSync(new URL('../test/fixtures/sam/red-box.txt', import.meta.url), 'utf8')

describe('bestMask', () => {
  it('places the box-relative mask back on a frame-sized canvas', async () => {
    const png = await bestMask(redBox)
    const { data, info } = await sharp(png!)
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([40, 30])
    const at = (x: number, y: number) => data[y * info.width + x]
    expect(at(17, 14)).toBe(255)
    expect(at(2, 2)).toBe(0)
    expect(at(35, 25)).toBe(0)
  })

  it('returns null when nothing matched', async () => {
    expect(await bestMask('')).toBeNull()
  })
})
