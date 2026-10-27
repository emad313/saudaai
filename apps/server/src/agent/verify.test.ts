import { describe, expect, it } from 'vitest'
import { checkCustomerReply, numbersIn } from './verify.ts'

const facts = new Set(['1250', '120', '60', '01700000000'])
const said = new Set(['01711000101', '27'])

describe('checkCustomerReply', () => {
  it('passes replies grounded in shop data', () => {
    expect(
      checkCustomerReply('Ji, XL ache, dam ৳1,250. Delivery ১২০ টাকা।', facts, said),
    ).toBeNull()
  })

  it('lets the customer details be repeated back', () => {
    expect(
      checkCustomerReply('Thikana: Road 27, phone 01711000101. Thik ache?', facts, said),
    ).toBeNull()
  })

  it('flags invented prices', () => {
    expect(checkCustomerReply('Dam 999 taka', facts, said)).toMatch(/999/)
  })

  it('flags prices the customer suggested', () => {
    expect(checkCustomerReply('Ji, 27 taka te dibo', facts, said)).toMatch(/27/)
  })

  it('flags offers', () => {
    expect(checkCustomerReply('Apnar jonno 10% off!', facts, said)).toBe('mentions an offer')
    expect(checkCustomerReply('100 taka discount dibo', facts, said)).toBe('mentions an offer')
  })

  it('allows refusing a discount', () => {
    expect(checkCustomerReply('Dukkhito, discount dite parbo na.', facts, said)).toBeNull()
  })
})

describe('numbersIn', () => {
  it('reads Bangla digits and ignores small counts', () => {
    expect(numbersIn('২ টা, দাম ১,২৫০')).toEqual(['1250'])
  })
})
