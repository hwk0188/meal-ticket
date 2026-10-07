// DB(claim_person 등)는 오류 코드를 message 에 문자열로 담아 보낸다 ({code:'P0001', message:'phone_taken'}).
const MESSAGES = {
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
  dev_login_disabled: '개발용 로그인은 사용할 수 없어요.',
} as const satisfies Record<string, string>

/** MESSAGES 에 문구가 있는 오류 코드. 호출하는 쪽에서 오타를 막는 데 쓴다. */
export type RpcErrorCode = keyof typeof MESSAGES

// 세션 만료·비로그인. 42501 은 Postgres 권한/RLS, PGRST301·302 는 PostgREST 의 JWT 오류다.
// 영문 문구는 상황마다 다르므로(permission denied…, JWT expired, new row violates RLS…) 코드로 먼저 본다.
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302'])
const PERMISSION_DENIED = /permission denied/i
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed/i

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

function fieldOf(err: unknown, key: 'message' | 'code'): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 오류 객체에서 message 문자열을 꺼낸다. Supabase RPC 는 message 에 코드 문자열(phone_taken 등)을 담는다. */
export function messageOf(err: unknown): string | undefined {
  return fieldOf(err, 'message')
}

/** 오류 객체에서 code 를 꺼낸다. 빈 문자열은 없는 것으로 본다. */
function codeOf(err: unknown): string | undefined {
  const code = fieldOf(err, 'code')
  return code === '' ? undefined : code
}

// 평범한 객체의 프로토타입 키(toString 등)에 걸리지 않도록 hasOwn 으로 본다.
function isRpcErrorCode(value: string): value is RpcErrorCode {
  return Object.hasOwn(MESSAGES, value)
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문구로 바꾼다. 모르는 오류는 일반 문구. */
export function toUserMessage(err: unknown): string {
  const message = messageOf(err)
  const code = codeOf(err)
  if (message && isRpcErrorCode(message)) return MESSAGES[message]
  if (code && AUTH_CODES.has(code)) return MESSAGES.not_authenticated
  if (!message) return FALLBACK
  if (PERMISSION_DENIED.test(message)) return MESSAGES.not_authenticated
  if (NETWORK_FAILURE.test(message)) return NETWORK
  return FALLBACK
}
