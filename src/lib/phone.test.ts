import { normalizePhone, isValidMobile, formatPhone, maskPhone } from './phone'

describe('phone', () => {
  it('숫자만 남긴다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678')
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678')
  })

  it('국제 표기는 010 으로 바꾼다 (DB normalize_phone 과 동일 규칙)', () => {
    expect(normalizePhone('+82 10-9876-5432')).toBe('01098765432')
    expect(normalizePhone('+82 010-9876-5432')).toBe('01098765432')
    expect(normalizePhone('0082-10-123-4567')).toBe('0101234567')
  })

  it('휴대폰 번호 형식을 검사한다', () => {
    expect(isValidMobile('01012345678')).toBe(true)
    expect(isValidMobile('0101234567')).toBe(true)
    expect(isValidMobile('0212345678')).toBe(false)
    expect(isValidMobile('010123')).toBe(false)
  })

  it('하이픈을 넣어 표시한다', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678')
    expect(formatPhone('0101234567')).toBe('010-123-4567')
    expect(formatPhone('')).toBe('')
  })

  it('가운데를 가린다', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678')
    expect(maskPhone('0101234567')).toBe('010-***-4567')
    expect(maskPhone(null)).toBe('')
  })
})
