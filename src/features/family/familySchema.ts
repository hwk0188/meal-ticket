import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'
import { validateWith, type Validation } from '../../lib/validate'

// 가입 화면과 같은 이름 규칙 (NFC 로 맞춘 뒤 길이를 센다)
export const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFC'))
  .pipe(z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요'))
// 코드는 "4829 1357" 처럼 띄워 보여 주므로 숫자만 남긴 뒤 8자리인지 본다 (DB 와 같은 길이 — 2단계 리뷰에서 6→8 로 늘렸다)
export const codeSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{8}$/, '8자리 숫자 코드를 입력해 주세요'))
const phoneSchema = z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요')

export const addChildSchema = z.object({
  name: nameSchema,
  code: codeSchema,
  consent: z.boolean().refine((v) => v === true, '법정대리인 동의가 필요해요'),
})
export const relinkSchema = z.object({ childId: z.string().min(1, '자녀를 선택해 주세요'), code: codeSchema })
export const joinSchema = z.object({ code: codeSchema })
export const profileSchema = z.object({ name: nameSchema, phone: phoneSchema })

export type AddChildInput = z.input<typeof addChildSchema>
export type AddChildValues = z.output<typeof addChildSchema>
export type RelinkInput = z.input<typeof relinkSchema>
export type RelinkValues = z.output<typeof relinkSchema>
export type JoinInput = z.input<typeof joinSchema>
export type JoinValues = z.output<typeof joinSchema>
export type ProfileInput = z.input<typeof profileSchema>
export type ProfileValues = z.output<typeof profileSchema>

export const validateAddChild = (input: AddChildInput): Validation<AddChildValues, AddChildInput> => validateWith(addChildSchema, input, 'name')
export const validateRelink = (input: RelinkInput): Validation<RelinkValues, RelinkInput> => validateWith(relinkSchema, input, 'code')
export const validateJoin = (input: JoinInput): Validation<JoinValues, JoinInput> => validateWith(joinSchema, input, 'code')
export const validateProfile = (input: ProfileInput): Validation<ProfileValues, ProfileInput> => validateWith(profileSchema, input, 'name')
