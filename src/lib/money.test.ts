import { formatWon } from './money'

describe('formatWon', () => {
  it('천 단위 쉼표와 원', () => {
    expect(formatWon(0)).toBe('0원')
    expect(formatWon(5000)).toBe('5,000원')
    expect(formatWon(1234567)).toBe('1,234,567원')
  })
})
