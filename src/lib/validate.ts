import type { z } from 'zod'

export type FieldErrors<In> = Partial<Record<keyof In & string, string>>
export type Validation<Out, In> = { ok: true; values: Out } | { ok: false; errors: FieldErrors<In> }

/**
 * 폼 입력을 zod 스키마로 검사해 정규화된 값, 또는 필드별 "첫" 오류 문구를 돌려준다 (화면에 한 줄씩만 둔다).
 * 어느 필드인지 모르는 오류(입력이 객체가 아닐 때처럼 타입이 막아 주는 경우)는 fallbackKey 자리에 일반 문구를 둔다 —
 * 화면이 아무 말도 못 하는 것보다 첫 칸에라도 띄우는 편이 낫다.
 */
export function validateWith<Out, In extends object>(
  schema: z.ZodType<Out, In>,
  input: In,
  fallbackKey: keyof In & string,
): Validation<Out, In> {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: FieldErrors<In> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string') {
      errors[fallbackKey] ??= '입력 내용을 확인해 주세요'
      continue
    }
    const field = key as keyof In & string
    if (!errors[field]) errors[field] = issue.message
  }
  return { ok: false, errors }
}
