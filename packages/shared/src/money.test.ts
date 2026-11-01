import { describe, expect, it } from 'vitest'
import { formatMoney, hasCents, parseTaka, sumPoisha, toMinor } from './money.ts'

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

describe('toMinor', () => {
  it('turns typed amounts with cents into exact minor units', () => {
    expect(toMinor(104.99)).toBe(10499)
    expect(toMinor(0.1 + 0.2)).toBe(30)
    expect(toMinor(1250)).toBe(125000)
  })

  it('accepts at most two decimals', () => {
    expect(hasCents(104.99)).toBe(true)
    expect(hasCents(19.999)).toBe(false)
  })
})
