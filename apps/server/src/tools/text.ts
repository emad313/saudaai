export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

export function normalizePhone(raw: string): string | null {
  const digits = raw
    .replace(/[^\d০-৯]/g, '')
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
  const local = digits.startsWith('880') ? digits.slice(2) : digits
  return /^01\d{9}$/.test(local) ? local : null
}

const dhakaOffsetMs = 6 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000

export function dhakaDayStart(at: number): number {
  return Math.floor((at + dhakaOffsetMs) / dayMs) * dayMs - dhakaOffsetMs
}

export function dhakaDate(at: number): string {
  return new Date(at + dhakaOffsetMs).toISOString().slice(0, 10)
}
