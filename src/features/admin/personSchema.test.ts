import { validateAdminPerson, validateAuthUserId } from './personSchema'

// 결과 전체를 한 번에 비교한다 (onboardingSchema.test.ts 와 같은 이유): `if (!r.ok) expect(...)` 는
// 조건부 expect 라서 (vitest/no-conditional-expect) 검사가 아예 안 돌아도 통과하고,
// 기대하지 않은 다른 필드 오류가 끼어도 못 잡는다.
describe('validateAdminPerson', () => {
  it('이름만 있어도 통과하고 번호는 비울 수 있다 (자녀·방문자)', () => {
    const r = validateAdminPerson({ name: '김철수', phone: '' })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: null } })
  })

  it('번호를 적으면 형식을 본다', () => {
    expect(validateAdminPerson({ name: '김철수', phone: '010-1234-5678' })).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678' } })
    expect(validateAdminPerson({ name: '김철수', phone: '02-123' })).toEqual({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요.' } })
  })

  it('이름이 비면 거부', () => {
    expect(validateAdminPerson({ name: '  ', phone: '' })).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요' } })
  })
})

describe('validateAuthUserId', () => {
  it('uuid 만 받는다', () => {
    expect(validateAuthUserId({ authUserId: ' 123e4567-e89b-42d3-a456-426614174000 ' })).toEqual({
      ok: true,
      values: { authUserId: '123e4567-e89b-42d3-a456-426614174000' },
    })
    expect(validateAuthUserId({ authUserId: 'abc' })).toEqual({ ok: false, errors: { authUserId: '계정 id(uuid)를 붙여 넣어 주세요' } })
  })
})
