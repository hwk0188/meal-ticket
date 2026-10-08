import { summarizeByMeal } from './summarizeByMeal'

describe('summarizeByMeal', () => {
  it('식사별로 발급·사용·금액을 더하고 가족 수를 센다', () => {
    const s = summarizeByMeal([
      { family_id: 'f1', meal_id: 'm1', issued: 4, used: 2, remaining: 2, amount: 20000 },
      { family_id: 'f2', meal_id: 'm1', issued: 2, used: 0, remaining: 2, amount: 10000 },
      { family_id: 'f1', meal_id: 'm2', issued: 1, used: 0, remaining: 1, amount: 0 },
      { family_id: null, meal_id: null, issued: null, used: null, remaining: null, amount: null },
    ])
    expect(s.get('m1')).toEqual({ issued: 6, used: 2, amount: 30000, families: 2 })
    expect(s.get('m2')).toEqual({ issued: 1, used: 0, amount: 0, families: 1 })
    expect(s.size).toBe(2)
  })
})
