import { describe, expect, it } from 'vitest'
import { normalizePhone } from './text.ts'

describe('normalizePhone', () => {
  it('reads local, international and Bangla digit mobile numbers', () => {
    expect(normalizePhone('01712-345678')).toBe('01712345678')
    expect(normalizePhone('+880 1912 345678')).toBe('01912345678')
    expect(normalizePhone('০১৮১২৩৪৫৬৭৮')).toBe('01812345678')
  })

  it('refuses numbers that are not Bangladeshi mobiles', () => {
    expect(normalizePhone('01233456433')).toBeNull()
    expect(normalizePhone('0171234567')).toBeNull()
    expect(normalizePhone('029876543')).toBeNull()
  })
})
