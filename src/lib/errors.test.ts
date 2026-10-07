import { toUserMessage } from './errors'

describe('toUserMessage', () => {
  it('DB 오류 코드를 사용자 문구로 바꾼다', () => {
    expect(toUserMessage({ message: 'phone_taken' })).toBe('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(toUserMessage(new Error('invalid_phone'))).toBe('휴대폰 번호를 확인해 주세요.')
  })

  it('모르는 오류는 일반 문구', () => {
    expect(toUserMessage(new Error('something odd'))).toBe('잠시 후 다시 시도해 주세요.')
    expect(toUserMessage(undefined)).toBe('잠시 후 다시 시도해 주세요.')
  })

  it('네트워크 오류는 통신 문구', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
  })

  it('권한 거부(세션 만료·비로그인)는 로그인 안내', () => {
    expect(toUserMessage({ code: '42501', message: 'permission denied for function claim_person' })).toBe('로그인이 필요해요.')
  })
})
