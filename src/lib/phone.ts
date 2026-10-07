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

/** 01012345678 → 010-1234-5678, 0101234567 → 010-123-4567 */
export function formatPhone(digits: string): string {
  if (!digits) return ''
  const head = digits.slice(0, 3)
  const tail = digits.slice(-4)
  const mid = digits.slice(3, -4)
  return [head, mid, tail].filter(Boolean).join('-')
}

/** 010-****-5678 */
export function maskPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  const formatted = formatPhone(digits)
  const [head, mid, tail] = formatted.split('-')
  return [head, '*'.repeat(mid.length), tail].join('-')
}
