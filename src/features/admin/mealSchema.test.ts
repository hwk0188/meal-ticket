import { validateMeal } from './mealSchema'

describe('validateMeal', () => {
  it('제목 공백 정리, 날짜 형식, 비고 선택', () => {
    expect(validateMeal({ title: ' 추수감사 점심 ', served_on: '2026-11-15', note: '' })).toEqual({
      ok: true, values: { title: '추수감사 점심', served_on: '2026-11-15', note: null },
    })
  })
  it('오류를 칸별로 돌려준다', () => {
    const r = validateMeal({ title: '', served_on: '2026/11/15', note: '가'.repeat(101) })
    expect(r).toMatchObject({
      ok: false,
      errors: { title: '식사 이름을 적어 주세요', served_on: '날짜를 골라 주세요', note: '비고는 100자까지예요' },
    })
    const long = validateMeal({ title: '가'.repeat(31), served_on: '2026-11-15', note: '' })
    expect(!long.ok && long.errors.title).toBe('식사 이름은 30자까지예요')
  })
})
