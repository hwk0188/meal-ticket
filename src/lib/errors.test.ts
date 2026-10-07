import { messageOf, toUserMessage } from './errors'

describe('toUserMessage', () => {
  it('DB 오류 코드를 사용자 문구로 바꾼다', () => {
    expect(toUserMessage({ message: 'phone_taken' })).toBe('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(toUserMessage(new Error('invalid_phone'))).toBe('휴대폰 번호를 확인해 주세요.')
  })

  it('개발 로그인 차단도 사용자 문구로 바꾼다', () => {
    expect(toUserMessage(new Error('dev_login_disabled'))).toBe('개발용 로그인은 사용할 수 없어요.')
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
    // 코드가 없어도 영문 문구로 알아본다 (코드 매핑의 예비 수단).
    expect(toUserMessage({ message: 'permission denied for table people' })).toBe('로그인이 필요해요.')
  })

  it('인증 오류는 영문 문구가 달라도 코드로 알아본다', () => {
    expect(toUserMessage({ code: 'PGRST301', message: 'JWT expired' })).toBe('로그인이 필요해요.')
    expect(
      toUserMessage({ code: '42501', message: 'new row violates row-level security policy for table "people"' }),
    ).toBe('로그인이 필요해요.')
  })
})

describe('messageOf', () => {
  it('객체의 message 문자열만 꺼낸다', () => {
    expect(messageOf({ message: 'already_registered' })).toBe('already_registered')
    expect(messageOf('str')).toBeUndefined()
  })
})
