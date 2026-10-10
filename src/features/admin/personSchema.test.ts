import { validateAdminPerson, validateAuthUserId } from './personSchema'

describe('validateAdminPerson', () => {
  it('이름만 있어도 통과하고 번호는 비울 수 있다 (자녀·방문자)', () => {
    const r = validateAdminPerson({ name: '김철수', phone: '' })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: null } })
  })

  it('번호를 적으면 형식을 본다', () => {
    expect(validateAdminPerson({ name: '김철수', phone: '010-1234-5678' })).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678' } })
    const bad = validateAdminPerson({ name: '김철수', phone: '02-123' })
    expect(bad.ok).toBe(false)
    // oxlint-disable-next-line vitest/no-conditional-expect -- 바로 위 expect(bad.ok).toBe(false) 로 좁힌 뒤의 타입 좁히기용 분기
    if (!bad.ok) expect(bad.errors.phone).toBe('휴대폰 번호를 확인해 주세요.')
  })

  it('이름이 비면 거부', () => {
    const r = validateAdminPerson({ name: '  ', phone: '' })
    expect(r.ok).toBe(false)
    // oxlint-disable-next-line vitest/no-conditional-expect -- 바로 위 expect(r.ok).toBe(false) 로 좁힌 뒤의 타입 좁히기용 분기
    if (!r.ok) expect(r.errors.name).toBe('이름을 입력해 주세요')
  })
})

describe('validateAuthUserId', () => {
  it('uuid 만 받는다', () => {
    expect(validateAuthUserId({ authUserId: ' 123e4567-e89b-42d3-a456-426614174000 ' })).toEqual({
      ok: true,
      values: { authUserId: '123e4567-e89b-42d3-a456-426614174000' },
    })
    const bad = validateAuthUserId({ authUserId: 'abc' })
    expect(bad.ok).toBe(false)
    // oxlint-disable-next-line vitest/no-conditional-expect -- 바로 위 expect(bad.ok).toBe(false) 로 좁힌 뒤의 타입 좁히기용 분기
    if (!bad.ok) expect(bad.errors.authUserId).toBe('계정 id(uuid)를 붙여 넣어 주세요')
  })
})
