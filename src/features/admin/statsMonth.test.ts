import { currentMonth, formatMonth, monthRange, shiftMonth } from './statsMonth'

describe('currentMonth', () => {
  it('오늘(YYYY-MM-DD)에서 YYYY-MM 을 뽑는다', () => {
    expect(currentMonth('2026-10-13')).toBe('2026-10')
    expect(currentMonth('2026-01-01')).toBe('2026-01')
  })
})

describe('monthRange', () => {
  it('그 달의 첫날과 마지막 날', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('2월은 평년 28일, 윤년 29일', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })
})

describe('shiftMonth', () => {
  it('앞뒤로 한 달', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
    expect(shiftMonth('2026-10', 1)).toBe('2026-11')
  })

  it('해를 넘는다', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})

describe('formatMonth', () => {
  it('사람이 읽는 표기 (0 을 떼고 "년 월")', () => {
    expect(formatMonth('2026-10')).toBe('2026년 10월')
    expect(formatMonth('2026-01')).toBe('2026년 1월')
  })
})

describe('형식이 아니면 던진다', () => {
  it('잘못된 월 문자열은 조용히 넘기지 않는다 (주소창으로 들어올 수 있다)', () => {
    expect(() => monthRange('2026-13')).toThrow('YYYY-MM')
    expect(() => monthRange('202610')).toThrow('YYYY-MM')
    expect(() => shiftMonth('', 1)).toThrow('YYYY-MM')
  })
})
