import { z } from 'zod'
import { validateWith } from './validate'

const schema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요').max(3, '너무 길어요'),
  age: z.number().min(1, '1 이상'),
})

describe('validateWith', () => {
  it('통과하면 정규화된 값을 돌려준다', () => {
    expect(validateWith(schema, { name: ' 김 ', age: 3 }, 'name')).toEqual({ ok: true, values: { name: '김', age: 3 } })
  })

  it('필드별 첫 오류 문구만 모은다', () => {
    const r = validateWith(schema, { name: '', age: 0 }, 'name')
    expect(r).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요', age: '1 이상' } })
  })

  it('어느 필드인지 모르는 오류는 fallbackKey 에 일반 문구를 둔다', () => {
    const r = validateWith(schema, 'not an object' as unknown as { name: string; age: number }, 'name')
    expect(r).toEqual({ ok: false, errors: { name: '입력 내용을 확인해 주세요' } })
  })
})
