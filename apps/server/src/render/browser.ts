import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium, type Browser } from 'playwright'

const require = createRequire(import.meta.url)
const fontDir = join(
  dirname(require.resolve('@fontsource/noto-sans-bengali/package.json')),
  'files',
)

function face(subset: string, weight: number, range: string) {
  const data = readFileSync(
    join(fontDir, `noto-sans-bengali-${subset}-${weight}-normal.woff2`),
  ).toString('base64')
  return `@font-face{font-family:'Noto Sans Bengali';font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`
}

let fonts: string | null = null

export function fontCss() {
  fonts ??= [400, 600, 700]
    .flatMap((w) => [
      face(
        'bengali',
        w,
        'U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1',
      ),
      face(
        'latin',
        w,
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      ),
      face(
        'latin-ext',
        w,
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      ),
    ])
    .join('')
  return fonts
}

let browser: Promise<Browser> | null = null

function launch() {
  browser ??= chromium.launch().catch((err) => {
    browser = null
    throw err
  })
  return browser
}

export function page(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss()}*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Noto Sans Bengali',sans-serif;-webkit-font-smoothing:antialiased}</style></head><body>${html}</body></html>`
}

export async function screenshot(html: string, size: { width: number; height?: number }) {
  const b = await launch()
  const p = await b.newPage({
    viewport: { width: size.width, height: size.height ?? 100 },
    deviceScaleFactor: 1,
  })
  try {
    await p.setContent(page(html), { waitUntil: 'load' })
    await p.evaluate(() => document.fonts.ready)
    return await p.screenshot({ type: 'png', fullPage: !size.height })
  } finally {
    await p.close()
  }
}

export async function pdf(html: string) {
  const b = await launch()
  const p = await b.newPage()
  try {
    await p.setContent(page(html), { waitUntil: 'load' })
    await p.evaluate(() => document.fonts.ready)
    return await p.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    })
  } finally {
    await p.close()
  }
}

export async function closeBrowser() {
  if (browser) await (await browser).close()
  browser = null
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
