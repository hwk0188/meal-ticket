import { messageOf, rpcCodeOf, toUserMessage } from './errors'

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

describe('2단계 오류 문구', () => {
  it.each([
    ['forbidden', '관리자만 할 수 있어요.'],
    ['not_registered', '가입을 먼저 해 주세요.'],
    ['meal_not_found', '식사를 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    ['person_not_found', '사람을 찾을 수 없어요.'],
    ['person_is_minor', '자녀 이름으로는 발급할 수 없어요. 보호자 이름으로 발급해 주세요.'],
    ['invalid_quantity', '장수는 1~99 사이로 적어 주세요.'],
    ['invalid_price', '단가는 0~1,000,000원 사이로 적어 주세요.'],
    ['invalid_memo', '메모는 100자까지예요.'],
    ['invalid_date', '날짜를 확인해 주세요.'],
    ['not_today', '오늘 식사의 식권만 쓸 수 있어요.'],
    ['no_remaining', '방금 다른 폰에서 사용되었어요.'],
    ['duplicate_request', '이미 처리된 요청이에요.'],
    ['invalid_request', '잘못된 요청이에요. 다시 눌러 주세요.'],
  ])('%s → 문구', (code, text) => {
    expect(toUserMessage({ message: code, code: 'P0001' })).toBe(text)
  })

  it('DB 제약 코드도 문구로 바꾼다 (직접 insert/delete 경로)', () => {
    expect(toUserMessage({ code: '23503', message: 'update or delete on table "meals" violates foreign key constraint' }))
      .toBe('연결된 기록이 있어 지울 수 없어요.')
    expect(toUserMessage({ code: '23505', message: 'duplicate key value violates unique constraint' }))
      .toBe('같은 값이 이미 있어요.')
  })

  it('CODE_MESSAGES 에 없는 프로토타입 키(toString 등)는 일반 문구를 쓴다', () => {
    expect(toUserMessage({ code: 'toString', message: 'x' })).toBe('잠시 후 다시 시도해 주세요.')
  })

  it('타임아웃·중단은 통신 문구', () => {
    expect(toUserMessage(new DOMException('signal timed out', 'TimeoutError'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
    expect(toUserMessage(new DOMException('The operation was aborted.', 'AbortError'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
  })

  it('supabase-js 가 직렬화한 통신 오류(코드 없음)는 통신 문구이고 rpc 코드가 아니다', () => {
    const timedOut = { message: 'TimeoutError: signal timed out', code: '', details: '', hint: '' }
    const aborted = { message: 'AbortError: The operation was aborted.', code: '', details: '', hint: '' }
    const failed = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }
    for (const err of [timedOut, aborted, failed]) {
      expect(toUserMessage(err)).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
      expect(rpcCodeOf(err)).toBeUndefined()
    }
  })

  it('rpcCodeOf 는 알려진 코드만 돌려준다', () => {
    expect(rpcCodeOf({ message: 'no_remaining' })).toBe('no_remaining')
    expect(rpcCodeOf({ message: 'something else' })).toBeUndefined()
    expect(rpcCodeOf(new Error('failed to fetch'))).toBeUndefined()
  })

  it('3단계(가족·아이) 오류 코드를 문구로 바꾼다', () => {
    expect(toUserMessage(new Error('invalid_code'))).toBe('코드가 맞지 않거나 만료되었어요. 새 코드를 받아 다시 입력해 주세요.')
    expect(toUserMessage(new Error('not_adult'))).toBe('어른 계정만 할 수 있어요.')
    expect(toUserMessage(new Error('has_children'))).toBe('연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.')
    expect(toUserMessage(new Error('child_not_found'))).toBe('자녀를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    expect(toUserMessage(new Error('invalid_kind'))).toBe('잘못된 요청이에요.')
    expect(toUserMessage(new Error('code_generation_failed'))).toBe('코드를 만들지 못했어요. 다시 시도해 주세요.')
    expect(toUserMessage(new Error('last_admin'))).toBe('마지막 관리자는 탈퇴할 수 없어요. 다른 관리자를 먼저 지정해 주세요.')
    expect(rpcCodeOf(new Error('invalid_code'))).toBe('invalid_code')
  })

  it('supabase-js 인증 오류는 code 필드로도 문구를 찾는다 (message 는 영문)', () => {
    expect(toUserMessage({ code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' })).toBe(
      '아이 계정 시작이 꺼져 있어요. 권사님께 문의해 주세요.',
    )
  })
})
