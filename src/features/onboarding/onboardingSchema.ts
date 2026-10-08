import { z } from 'zod'
import { nameSchema, phoneSchema } from '../../lib/fieldSchemas'
import { validateWith, type FieldErrors, type Validation } from '../../lib/validate'

// 가입 화면의 입력 규칙. 문구는 사용자에게 그대로 보이므로 DB 오류 코드와 따로 둔다.
export const onboardingSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  // z.literal(true) 로 쓰면 입력 타입까지 true 로 좁혀져 boolean 폼 상태를 넣을 수 없다. refine 으로 둔다.
  consent: z.boolean().refine((v) => v === true, '개인정보 동의가 필요해요'),
})

export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>
export type OnboardingErrors = FieldErrors<OnboardingInput>

/** 폼 입력을 검사해 정규화된 값 또는 필드별 첫 오류 문구를 돌려준다. */
export function validateOnboarding(input: OnboardingInput): Validation<OnboardingValues, OnboardingInput> {
  return validateWith(onboardingSchema, input, 'name')
}
