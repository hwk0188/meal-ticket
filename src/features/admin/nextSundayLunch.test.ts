import { nextSundayLunchDate, SUNDAY_LUNCH_TITLE } from './nextSundayLunch'

const meal = (served_on: string, title = SUNDAY_LUNCH_TITLE) => ({ id: served_on + title, title, served_on, note: null, created_by: null, created_at: '' })

describe('nextSundayLunchDate (DB create_next_sunday_lunch 와 같은 규칙)', () => {
  it('가장 늦은 주일 점심 다음 일요일', () => {
    expect(nextSundayLunchDate([meal('2026-10-11'), meal('2026-10-04')], '2026-10-08')).toBe('2026-10-18')
  })
  it('주일 점심이 없거나 과거면 오늘 이후 첫 일요일 (오늘이 일요일이면 오늘)', () => {
    expect(nextSundayLunchDate([], '2026-10-08')).toBe('2026-10-11')
    expect(nextSundayLunchDate([meal('2026-09-06')], '2026-12-06')).toBe('2026-12-06')
    expect(nextSundayLunchDate([meal('2026-09-06')], '2026-12-07')).toBe('2026-12-13')
  })
  it('다른 제목의 식사는 기준이 아니다', () => {
    expect(nextSundayLunchDate([meal('2026-10-18', '추수감사 점심')], '2026-10-08')).toBe('2026-10-11')
  })
})
