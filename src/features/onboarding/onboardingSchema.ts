import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'
import { validateWith, type FieldErrors, type Validation } from '../../lib/validate'

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
export type OnboardingErrors = FieldErrors<OnboardingInput>

/** 폼 입력을 검사해 정규화된 값 또는 필드별 첫 오류 문구를 돌려준다. */
export function validateOnboarding(input: OnboardingInput): Validation<OnboardingValues, OnboardingInput> {
  return validateWith(onboardingSchema, input, 'name')
}
