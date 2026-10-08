import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'

export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 99
export const PRICE_MAX = 1_000_000

const QUANTITY_MSG = '장수는 1~99장이에요'
const PRICE_RANGE_MSG = '단가는 0~1,000,000원이에요'

const schema = z.object({
  quantity: z.number().int(QUANTITY_MSG).min(QUANTITY_MIN, QUANTITY_MSG).max(QUANTITY_MAX, QUANTITY_MSG),
  unitPrice: z.number().int(PRICE_RANGE_MSG).min(0, PRICE_RANGE_MSG).max(PRICE_MAX, PRICE_RANGE_MSG),
  memo: z.string().trim().max(100, '메모는 100자까지예요'),
})

export type IssueInput = { quantity: number; unitPrice: string; memo: string }
export type IssueValues = { quantity: number; unitPrice: number; memo: string | null }
export type IssueErrors = Partial<Record<keyof IssueInput, string>>

/** 단가는 입력칸의 문자열이다. 쉼표를 허용하고, 비었거나 숫자가 아니면 칸별 오류를 낸다. */
export function validateIssue(input: IssueInput): { ok: true; values: IssueValues } | { ok: false; errors: IssueErrors } {
  const priceText = input.unitPrice.replace(/,/g, '').trim()
  const errors: IssueErrors = {}
  if (priceText === '') errors.unitPrice = '단가를 적어 주세요 (이월은 0)'
  else if (!/^\d+$/.test(priceText)) errors.unitPrice = '단가는 숫자로 적어 주세요'

  const result = schema.safeParse({ quantity: input.quantity, unitPrice: errors.unitPrice ? 0 : Number(priceText), memo: input.memo })
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]) as keyof IssueInput
      errors[key] ??= issue.message
    }
    return { ok: false, errors }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const { quantity, unitPrice, memo } = result.data
  return { ok: true, values: { quantity, unitPrice, memo: memo || null } }
}

export type NewPersonInput = { name: string; phone: string }
export type NewPersonErrors = Partial<Record<keyof NewPersonInput, string>>

/** 선발급용 "새로 등록". 가입 화면과 같은 규칙(이름 1~20자, 휴대폰 형식)이되 동의 체크는 없다(가입 때 받는다). */
export function validateNewPerson(input: NewPersonInput): { ok: true; values: NewPersonInput } | { ok: false; errors: NewPersonErrors } {
  const name = input.name.trim().normalize('NFC')
  const phone = normalizePhone(input.phone)
  const errors: NewPersonErrors = {}
  if (name.length === 0) errors.name = '이름을 적어 주세요'
  else if (name.length > 20) errors.name = '이름은 20자까지예요'
  if (!isValidMobile(phone)) errors.phone = '휴대폰 번호를 확인해 주세요'
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: { name, phone } }
}
