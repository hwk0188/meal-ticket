const MOBILE = /^01[0-9]{8,9}$/

/** 숫자만 남기고, 국제 표기(+82 10…, +82 010…, 0082…)는 010 으로 바꾼다. DB 의 normalize_phone() 과 같은 규칙. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  const intl = /^(?:00)?820?(1[0-9]{8,9})$/.exec(digits)
  return intl ? `0${intl[1]}` : digits
}

/** DB 의 is_valid_mobile() 과 같은 규칙. 정규화된 숫자열을 넣는다. */
export function isValidMobile(digits: string): boolean {
  return MOBILE.test(digits)
}

/** 완성된 휴대폰 번호만 하이픈을 넣는다. 입력 중(형식 미완성)이면 그대로 돌려준다. */
export function formatPhone(digits: string): string {
  if (!isValidMobile(digits)) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`
}

/** 010-****-5678. 모르는 형식은 드러내지 않는다. */
export function maskPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  if (!isValidMobile(digits)) return '***'
  const mid = digits.slice(3, -4)
  return `${digits.slice(0, 3)}-${'*'.repeat(mid.length)}-${digits.slice(-4)}`
}
