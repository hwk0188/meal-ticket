// DB 함수는 오류 코드를 message 에 문자열로 담아 보낸다 ({code:'P0001', message:'phone_taken'}).
const MESSAGES = {
  // 1단계 · 가입
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
  dev_login_disabled: '개발용 로그인은 사용할 수 없어요.',
  // 2단계 · 발급·사용
  forbidden: '관리자만 할 수 있어요.',
  not_registered: '가입을 먼저 해 주세요.',
  meal_not_found: '식사를 찾을 수 없어요. 목록을 새로고침해 주세요.',
  person_not_found: '사람을 찾을 수 없어요.',
  person_is_minor: '자녀 이름으로는 발급할 수 없어요. 보호자 이름으로 발급해 주세요.',
  invalid_quantity: '장수는 1~99 사이로 적어 주세요.',
  invalid_price: '단가는 0~1,000,000원 사이로 적어 주세요.',
  invalid_memo: '메모는 100자까지예요.',
  invalid_date: '날짜를 확인해 주세요.',
  not_today: '오늘 식사의 식권만 쓸 수 있어요.',
  no_remaining: '방금 다른 폰에서 사용되었어요.',
  duplicate_request: '이미 처리된 요청이에요.',
  invalid_request: '잘못된 요청이에요. 다시 눌러 주세요.',
  // 3단계 · 가족·아이
  invalid_kind: '잘못된 요청이에요.',
  not_adult: '어른 계정만 할 수 있어요.',
  invalid_code: '코드가 맞지 않거나 만료되었어요. 새 코드를 받아 다시 입력해 주세요.',
  child_not_found: '자녀를 찾을 수 없어요. 목록을 새로고침해 주세요.',
  has_children: '연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.',
  code_generation_failed: '코드를 만들지 못했어요. 다시 시도해 주세요.',
  last_admin: '마지막 관리자는 탈퇴할 수 없어요. 다른 관리자를 먼저 지정해 주세요.',
  anonymous_provider_disabled: '아이 계정 시작이 꺼져 있어요. 권사님께 문의해 주세요.',
} as const satisfies Record<string, string>

/** MESSAGES 에 문구가 있는 오류 코드. 호출하는 쪽에서 오타를 막는 데 쓴다. */
export type RpcErrorCode = keyof typeof MESSAGES

// 테이블에 직접 쓰는 경로(관리자 식사 추가·삭제, 선발급 사람 등록)에서 새는 Postgres 제약 코드
const CODE_MESSAGES: Record<string, string> = {
  '23503': '연결된 기록이 있어 지울 수 없어요.',
  '23505': '같은 값이 이미 있어요.',
}

// 세션 만료·비로그인. 42501 은 Postgres 권한/RLS, PGRST301·302 는 PostgREST 의 JWT 오류다.
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302'])
const PERMISSION_DENIED = /permission denied/i
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|timed out|aborted|^(?:AbortError|TimeoutError):/i

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

function fieldOf(err: unknown, key: 'message' | 'code' | 'name'): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 오류 객체에서 message 문자열을 꺼낸다. Supabase RPC 는 message 에 코드 문자열(phone_taken 등)을 담는다. */
export function messageOf(err: unknown): string | undefined {
  return fieldOf(err, 'message')
}

/** 오류 객체에서 code 를 꺼낸다. 빈 문자열은 없는 것으로 본다. */
export function codeOf(err: unknown): string | undefined {
  const code = fieldOf(err, 'code')
  return code === '' ? undefined : code
}

// 평범한 객체의 프로토타입 키(toString 등)에 걸리지 않도록 hasOwn 으로 본다.
function isRpcErrorCode(value: string): value is RpcErrorCode {
  return Object.hasOwn(MESSAGES, value)
}

/** 서버 함수가 판정한 오류 코드. 통신 오류처럼 판정이 없는 경우는 undefined (→ 같은 요청을 재시도해도 된다). */
export function rpcCodeOf(err: unknown): RpcErrorCode | undefined {
  const message = messageOf(err)
  return message && isRpcErrorCode(message) ? message : undefined
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문구로 바꾼다. 모르는 오류는 일반 문구. */
export function toUserMessage(err: unknown): string {
  const code = codeOf(err)
  // supabase-js 의 AuthApiError 등은 코드 문자열을 message 가 아니라 code 에 담는다
  // (예: signInAnonymously 가 꺼져 있으면 code: 'anonymous_provider_disabled', message 는 영문).
  const rpc = rpcCodeOf(err) ?? (code && isRpcErrorCode(code) ? code : undefined)
  if (rpc) return MESSAGES[rpc]
  if (code && AUTH_CODES.has(code)) return MESSAGES.not_authenticated
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const name = fieldOf(err, 'name')
  if (name === 'TimeoutError' || name === 'AbortError') return NETWORK
  const message = messageOf(err)
  if (!message) return FALLBACK
  if (PERMISSION_DENIED.test(message)) return MESSAGES.not_authenticated
  if (NETWORK_FAILURE.test(message)) return NETWORK
  return FALLBACK
}
