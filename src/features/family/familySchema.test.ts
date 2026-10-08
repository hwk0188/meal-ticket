import { validateAddChild, validateJoin, validateProfile, validateRelink } from './familySchema'

describe('validateAddChild', () => {
  it('이름 공백 제거·NFC, 코드는 숫자만 남겨 8자리', () => {
    const r = validateAddChild({ name: ' 서연 ', code: '4829 1357', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '서연', code: '48291357', consent: true } })
  })
  it('이름이 비면 오류', () => {
    expect(validateAddChild({ name: ' ', code: '48291357', consent: true })).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요' } })
  })
  it('코드가 8자리 숫자가 아니면 오류', () => {
    expect(validateAddChild({ name: '서연', code: '1234567', consent: true })).toEqual({ ok: false, errors: { code: '8자리 숫자 코드를 입력해 주세요' } })
  })
  it('동의가 없으면 오류', () => {
    expect(validateAddChild({ name: '서연', code: '48291357', consent: false })).toEqual({ ok: false, errors: { consent: '법정대리인 동의가 필요해요' } })
  })
})

describe('validateRelink', () => {
  it('자녀 id 와 코드', () => {
    expect(validateRelink({ childId: 'p2', code: '4829-1357' })).toEqual({ ok: true, values: { childId: 'p2', code: '48291357' } })
    expect(validateRelink({ childId: '', code: '48291357' })).toEqual({ ok: false, errors: { childId: '자녀를 선택해 주세요' } })
  })
})

describe('validateJoin', () => {
  it('코드만', () => {
    expect(validateJoin({ code: '00001111' })).toEqual({ ok: true, values: { code: '00001111' } })
    expect(validateJoin({ code: 'abc' })).toEqual({ ok: false, errors: { code: '8자리 숫자 코드를 입력해 주세요' } })
  })
})

describe('validateProfile', () => {
  it('이름·번호 (번호는 정규화)', () => {
    expect(validateProfile({ name: '김철수', phone: '+82 10-1234-5678' })).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678' } })
    expect(validateProfile({ name: '김철수', phone: '02-123-4567' })).toEqual({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })
})
