import { groupTickets, type Balance, type Meal } from './groupTickets'

const meal = (id: string, served_on: string, title = '주일 점심'): Meal => ({
  id,
  title,
  served_on,
  note: null,
  created_by: 'admin',
  created_at: '2026-10-01T00:00:00Z',
})
const balance = (meal_id: string, issued: number, used: number): Balance => ({
  family_id: 'f1',
  meal_id,
  issued,
  used,
  remaining: issued - used,
  amount: issued * 5000,
})

describe('groupTickets', () => {
  const today = '2026-10-12'
  const meals = [
    meal('m-past', '2026-10-05'),
    meal('m-today', '2026-10-12'),
    meal('m-dinner', '2026-10-12', '저녁'),
    meal('m-next', '2026-10-19'),
    meal('m-far', '2026-10-26'),
  ]

  it('오늘 식사는 식권이 없어도 모두 나온다 (제목순). 잔량은 뷰 값, 없으면 0', () => {
    const { today: t } = groupTickets(meals, [balance('m-today', 4, 1)], today)
    expect(t.map((g) => g.meal.id)).toEqual(['m-dinner', 'm-today'])
    expect(t[1]).toMatchObject({ issued: 4, used: 1, remaining: 3, amount: 20000 })
    expect(t[0]).toMatchObject({ issued: 0, used: 0, remaining: 0, amount: 0 })
  })

  it('다가오는 식권은 날짜 오름차순, 식권이 있는 식사만', () => {
    const { upcoming } = groupTickets(meals, [balance('m-far', 1, 0), balance('m-next', 4, 0)], today)
    expect(upcoming.map((g) => g.meal.id)).toEqual(['m-next', 'm-far'])
  })

  it('지난 식권은 날짜 내림차순, 발급이 있는 것만', () => {
    const { past } = groupTickets([...meals, meal('m-older', '2026-09-28')], [balance('m-past', 2, 1), balance('m-older', 3, 3)], today)
    expect(past.map((g) => g.meal.id)).toEqual(['m-past', 'm-older'])
    expect(past[0]?.remaining).toBe(1)
  })

  it('식사 정보가 없는 잔량 행은 무시한다 (조회 사이에 식사가 지워진 경우)', () => {
    const { upcoming, past } = groupTickets(meals, [balance('m-deleted', 1, 0)], today)
    expect(upcoming).toEqual([])
    expect(past).toEqual([])
  })
})
