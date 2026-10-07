const MESSAGES: Record<string, string> = {
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
}

// PostgREST 권한 오류(세션 만료·비로그인). code 가 42501 로 오고 message 는 영문 권한 문구다.
const PERMISSION_DENIED = /permission denied/i
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed/i

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

/** 오류 객체에서 message 문자열을 꺼낸다. Supabase RPC 는 message 에 코드 문자열(phone_taken 등)을 담는다. */
export function messageOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const m = (err as { message?: unknown }).message
  return typeof m === 'string' ? m : undefined
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문구로 바꾼다. 모르는 오류는 일반 문구. */
export function toUserMessage(err: unknown): string {
  const message = messageOf(err)
  if (!message) return FALLBACK
  // 평범한 객체의 프로토타입 키(toString 등)에 걸리지 않도록 hasOwn 으로 본다.
  if (Object.hasOwn(MESSAGES, message)) return MESSAGES[message]
  if (PERMISSION_DENIED.test(message)) return MESSAGES.not_authenticated
  if (NETWORK_FAILURE.test(message)) return NETWORK
  return FALLBACK
}
