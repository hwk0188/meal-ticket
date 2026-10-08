import type { Balance } from '../tickets/groupTickets'

export type MealSummary = { issued: number; used: number; amount: number; families: number }

/** 관리자 식사 카드용: 모든 가족의 잔량 행을 식사별로 합친다 */
export function summarizeByMeal(balances: readonly Balance[]): Map<string, MealSummary> {
  const out = new Map<string, MealSummary>()
  for (const b of balances) {
    if (!b.meal_id) continue
    const s = out.get(b.meal_id) ?? { issued: 0, used: 0, amount: 0, families: 0 }
    out.set(b.meal_id, {
      issued: s.issued + (b.issued ?? 0),
      used: s.used + (b.used ?? 0),
      amount: s.amount + (b.amount ?? 0),
      families: s.families + 1,
    })
  }
  return out
}
