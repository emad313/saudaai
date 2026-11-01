import { describe, expect, it } from 'vitest'
import { formatMoney, parseTaka, sumPoisha } from './money.ts'

describe('parseTaka', () => {
  it.each([
    ['850', 85000],
    ['1,250', 125000],
    ['99.5', 9950],
    ['99.05', 9905],
    [' 60 ', 6000],
    ['0', 0],
  ])('%s -> %i', (input, poisha) => {
    expect(parseTaka(input)).toBe(poisha)
  })

  it.each(['', 'abc', '-5', '1.234', '12e3', '1..2'])('rejects %j', (input) => {
    expect(parseTaka(input)).toBeNull()
  })
})

describe('formatMoney', () => {
  it('groups thousands the way Bangladesh writes them', () => {
    expect(formatMoney(12345600)).toBe('৳1,23,456')
  })

  it('formats other currencies with their own symbol', () => {
    expect(formatMoney(150000, 'USD')).toBe('$1,500')
    expect(formatMoney(149950, 'USD')).toBe('$1,499.50')
    expect(formatMoney(150000, 'EUR')).toBe('€1,500')
  })

  it('keeps poisha when present', () => {
    expect(formatMoney(9905)).toBe('৳99.05')
  })

  it('refuses floats', () => {
    expect(() => formatMoney(10.5)).toThrow()
  })
})

describe('sumPoisha', () => {
  it('adds integers and refuses floats', () => {
    expect(sumPoisha([125000, 6000])).toBe(131000)
    expect(() => sumPoisha([1, 0.1])).toThrow()
  })
})
