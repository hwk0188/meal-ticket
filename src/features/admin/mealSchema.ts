import { z } from 'zod'

const schema = z.object({
  title: z.string().trim().min(1, '식사 이름을 적어 주세요').max(30, '식사 이름은 30자까지예요'),
  served_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜를 골라 주세요'),
  note: z.string().trim().max(100, '비고는 100자까지예요'),
})

export type MealInput = { title: string; served_on: string; note: string }
export type MealValues = { title: string; served_on: string; note: string | null }
export type MealErrors = Partial<Record<keyof MealInput, string>>

export function validateMeal(input: MealInput): { ok: true; values: MealValues } | { ok: false; errors: MealErrors } {
  const result = schema.safeParse(input)
  if (!result.success) {
    const errors: MealErrors = {}
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]) as keyof MealInput
      errors[key] ??= issue.message
    }
    return { ok: false, errors }
  }
  const { title, served_on, note } = result.data
  return { ok: true, values: { title, served_on, note: note || null } }
}
