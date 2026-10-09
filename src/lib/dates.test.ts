import { addDays, formatClock, formatDate, formatDateTime, formatMealDate, formatShortDate, formatTime, nextSundayAfter, todaySeoul } from './dates'

describe('todaySeoul', () => {
  it('서울 기준 날짜를 YYYY-MM-DD 로 준다 (UTC 자정 전후가 갈린다)', () => {
    // 2026-10-11 23:30 UTC = 10-12 08:30 KST
    expect(todaySeoul(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-12')
    // 2026-10-12 14:59 UTC = 10-12 23:59 KST / 15:00 UTC = 10-13 00:00 KST
    expect(todaySeoul(new Date('2026-10-12T14:59:00Z'))).toBe('2026-10-12')
    expect(todaySeoul(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-13')
  })
})

describe('formatMealDate', () => {
  it('일요일은 (주일), 나머지는 요일 한 글자', () => {
    expect(formatMealDate('2026-10-11')).toBe('10월 11일 (주일)')
    expect(formatMealDate('2026-10-12')).toBe('10월 12일 (월)')
    expect(formatMealDate('2026-01-03')).toBe('1월 3일 (토)')
  })
  it('짧은 형식', () => {
    expect(formatShortDate('2026-10-12')).toBe('10/12')
  })
  it('형식이 아니면 던진다', () => {
    expect(() => formatShortDate('2026-1-2')).toThrow(/YYYY-MM-DD/)
  })
})

describe('formatTime / formatDateTime / formatClock', () => {
  it('서울 시각 HH:MM', () => {
    expect(formatTime('2026-10-12T03:31:00Z')).toBe('12:31')
    expect(formatTime('2026-10-12T15:05:00Z')).toBe('00:05')
  })
  it('날짜와 시각', () => {
    expect(formatDateTime('2026-10-12T03:31:00Z')).toBe('10/12 12:31')
  })
  it('초 단위 시계', () => {
    expect(formatClock(new Date('2026-10-12T03:31:07Z'))).toBe('12:31:07')
  })
})

describe('nextSundayAfter', () => {
  it('기준일 다음의 첫 일요일 (DB create_next_sunday_lunch 와 같은 규칙)', () => {
    expect(nextSundayAfter('2026-10-11')).toBe('2026-10-18') // 일요일 → 다음 주
    expect(nextSundayAfter('2026-10-07')).toBe('2026-10-11') // 수요일
    expect(nextSundayAfter('2026-10-10')).toBe('2026-10-11') // 토요일
    expect(nextSundayAfter('2026-10-05')).toBe('2026-10-11') // 월요일
  })
})

describe('addDays', () => {
  it('날짜 문자열에 날수를 더한다 (월·연 넘김 포함)', () => {
    expect(addDays('2026-10-12', -1)).toBe('2026-10-11')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('formatDate', () => {
  it('ISO 시각을 서울 날짜 M/D 로 (UTC 저녁은 서울의 다음 날)', () => {
    expect(formatDate('2026-10-07T15:30:00Z')).toBe('10/8')
    expect(formatDate('2026-10-07T03:00:00Z')).toBe('10/7')
  })
})
