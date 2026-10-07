import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'

// 가입 화면의 입력 규칙. 문구는 사용자에게 그대로 보이므로 DB 오류 코드와 따로 둔다.
export const onboardingSchema = z.object({
  // 한글은 조합형(NFD)으로도 들어온다 (iOS 자판·붙여넣기). 그때는 '김' 한 자가 3자로 세어져
  // 20자 제한에 억울하게 걸린다. 완성형(NFC)으로 맞춘 뒤 길이를 센다. DB 에 가는 값도 NFC 가 된다.
  name: z
    .string()
    .transform((s) => s.normalize('NFC'))
    .pipe(z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요')),
  // 하이픈·공백·국제 표기를 먼저 숫자열로 정리한 뒤 형식을 본다 (DB 의 normalize_phone 과 같은 규칙).
  phone: z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요'),
  // z.literal(true) 로 쓰면 입력 타입까지 true 로 좁혀져 boolean 폼 상태를 넣을 수 없다. refine 으로 둔다.
  consent: z.boolean().refine((v) => v === true, '개인정보 동의가 필요해요'),
})

export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>
export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>

/** 폼 입력을 검사해 정규화된 값 또는 필드별 첫 오류 문구를 돌려준다. */
export function validateOnboarding(
  input: OnboardingInput,
): { ok: true; values: OnboardingValues } | { ok: false; errors: OnboardingErrors } {
  const result = onboardingSchema.safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: OnboardingErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof OnboardingInput | undefined
    if (!key) {
      // 입력이 객체가 아닐 때처럼 어느 필드인지 모르는 오류. 화면이 아무 말도 못 하는 편보다
      // 첫 칸에 일반 문구라도 띄우는 편이 낫다 (타입이 막아 주므로 사실상 닿지 않는다).
      errors.name ??= '입력 내용을 확인해 주세요'
      continue
    }
    // 한 필드에 여러 오류가 걸리면 첫 문구만 보여 준다 (화면에 한 줄씩만 둔다).
    if (!errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}
