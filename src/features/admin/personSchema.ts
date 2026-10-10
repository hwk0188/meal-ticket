import { z } from 'zod'
import { nameSchema } from '../../lib/fieldSchemas'
import { isValidMobile, normalizePhone } from '../../lib/phone'
import { validateWith, type Validation } from '../../lib/validate'

// 관리자 수정 화면의 번호는 비울 수 있다 — 자녀·방문자는 번호가 없고, 잘못 들어간 번호를 지워야 할 때도 있다.
const optionalPhoneSchema = z
  .string()
  .transform((s) => normalizePhone(s))
  .transform((s) => (s === '' ? null : s))
  .refine((s) => s === null || isValidMobile(s), '휴대폰 번호를 확인해 주세요.')

export const adminPersonSchema = z.object({ name: nameSchema, phone: optionalPhoneSchema })
export const authUserIdSchema = z.object({
  authUserId: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '계정 id(uuid)를 붙여 넣어 주세요')),
})

export type AdminPersonInput = z.input<typeof adminPersonSchema>
export type AdminPersonValues = z.output<typeof adminPersonSchema>
export type AuthUserIdInput = z.input<typeof authUserIdSchema>
export type AuthUserIdValues = z.output<typeof authUserIdSchema>

export const validateAdminPerson = (input: AdminPersonInput): Validation<AdminPersonValues, AdminPersonInput> =>
  validateWith(adminPersonSchema, input, 'name')
export const validateAuthUserId = (input: AuthUserIdInput): Validation<AuthUserIdValues, AuthUserIdInput> =>
  validateWith(authUserIdSchema, input, 'authUserId')
