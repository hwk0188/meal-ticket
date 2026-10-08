import { validateIssue, validateNewPerson } from './issueSchema'

describe('validateIssue', () => {
  it('장수·단가(쉼표 허용)·메모를 정리한다', () => {
    expect(validateIssue({ quantity: 4, unitPrice: '5,000', memo: ' 입금 확인 ' })).toEqual({
      ok: true, values: { quantity: 4, unitPrice: 5000, memo: '입금 확인' },
    })
    expect(validateIssue({ quantity: 1, unitPrice: '0', memo: '' })).toEqual({ ok: true, values: { quantity: 1, unitPrice: 0, memo: null } })
  })

  it('범위 밖·빈 단가·숫자 아님', () => {
    expect(validateIssue({ quantity: 0, unitPrice: '5000', memo: '' })).toMatchObject({ ok: false, errors: { quantity: '장수는 1~99장이에요' } })
    expect(validateIssue({ quantity: 100, unitPrice: '5000', memo: '' })).toMatchObject({ ok: false, errors: { quantity: '장수는 1~99장이에요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가를 적어 주세요 (이월은 0)' } })
    expect(validateIssue({ quantity: 1, unitPrice: '오천', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가는 숫자로 적어 주세요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '1000001', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가는 0~1,000,000원이에요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '5000', memo: '가'.repeat(101) })).toMatchObject({ ok: false, errors: { memo: '메모는 100자까지예요' } })
  })
})

describe('validateNewPerson', () => {
  it('이름 공백 정리, 번호 정규화', () => {
    expect(validateNewPerson({ name: ' 이순자 ', phone: '010-2222-0001' })).toEqual({ ok: true, values: { name: '이순자', phone: '01022220001' } })
  })
  it('오류', () => {
    expect(validateNewPerson({ name: '', phone: '01022220001' })).toMatchObject({ ok: false, errors: { name: '이름을 적어 주세요' } })
    expect(validateNewPerson({ name: '이순자', phone: '02-123-4567' })).toMatchObject({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })
})
