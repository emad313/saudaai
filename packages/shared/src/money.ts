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

export function formatTaka(poisha: number): string {
  if (!Number.isInteger(poisha)) throw new Error(`poisha must be an integer, got ${poisha}`)
  const sign = poisha < 0 ? '-' : ''
  const abs = Math.abs(poisha)
  const whole = Math.floor(abs / 100).toLocaleString('en-IN')
  const rest = abs % 100
  return rest === 0 ? `${sign}৳${whole}` : `${sign}৳${whole}.${String(rest).padStart(2, '0')}`
}

export function sumPoisha(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isInteger(value)) throw new Error(`poisha must be an integer, got ${value}`)
    return total + value
  }, 0)
}
