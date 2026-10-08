import { z } from 'zod'
import { validateWith, type FieldErrors } from '../../lib/validate'

const schema = z.object({
  title: z.string().trim().min(1, '식사 이름을 적어 주세요').max(30, '식사 이름은 30자까지예요'),
  served_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜를 골라 주세요'),
  note: z.string().trim().max(100, '비고는 100자까지예요'),
})

export type MealInput = { title: string; served_on: string; note: string }
export type MealValues = { title: string; served_on: string; note: string | null }
export type MealErrors = FieldErrors<MealInput>

export function validateMeal(input: MealInput): { ok: true; values: MealValues } | { ok: false; errors: MealErrors } {
  const result = validateWith(schema, input, 'title')
  if (!result.ok) return result
  const { title, served_on, note } = result.values
  return { ok: true, values: { title, served_on, note: note || null } }
}
