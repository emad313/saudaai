const takaPattern = /^(\d{1,9})(?:\.(\d{1,2}))?$/

/**
 * Parses a taka amount as typed by a person ("850", "1,250", "99.5") into integer poisha.
 * Returns null for anything that is not a plain non-negative amount.
 */
export function parseTaka(input: string): number | null {
  const match = takaPattern.exec(input.trim().replaceAll(',', ''))
  if (!match) return null
  const [, whole, fraction = ''] = match
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

// Currencies with two minor-unit digits; money is always stored as integer minor units (poisha, cents).
export const currencies = [
  'BDT',
  'USD',
  'INR',
  'PKR',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'MYR',
  'NGN',
  'KES',
] as const
export type Currency = (typeof currencies)[number]

export const isCurrency = (code: string): code is Currency =>
  (currencies as readonly string[]).includes(code)

/** Formats integer minor units in the shop's currency: ৳1,23,456 for BDT, $1,234.50 for USD. */
export function formatMoney(minor: number, currency: string = 'BDT'): string {
  if (!Number.isInteger(minor)) throw new Error(`money must be integer minor units, got ${minor}`)
  if (currency === 'BDT') {
    const sign = minor < 0 ? '-' : ''
    const abs = Math.abs(minor)
    const whole = Math.floor(abs / 100).toLocaleString('en-IN')
    const rest = abs % 100
    return rest === 0 ? `${sign}৳${whole}` : `${sign}৳${whole}.${String(rest).padStart(2, '0')}`
  }
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100)
}

export function sumPoisha(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isInteger(value)) throw new Error(`poisha must be an integer, got ${value}`)
    return total + value
  }, 0)
}
