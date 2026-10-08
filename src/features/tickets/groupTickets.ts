import type { Database } from '../../lib/database.types'

export type Meal = Database['public']['Tables']['meals']['Row']
export type Balance = Database['public']['Views']['ticket_balances']['Row']
export type Usage = Database['public']['Tables']['usages']['Row']

/** 한 식사에 대한 우리 가족 식권 묶음. 뷰에 행이 없으면(식권 없음) 0 으로 채운다. */
export type TicketGroup = { meal: Meal; issued: number; used: number; remaining: number; amount: number }
export type TicketGroups = { today: TicketGroup[]; upcoming: TicketGroup[]; past: TicketGroup[] }

const byTitle = (a: Meal, b: Meal) => a.title.localeCompare(b.title, 'ko')
const byDateAsc = (a: Meal, b: Meal) => a.served_on.localeCompare(b.served_on)
const byDateDesc = (a: Meal, b: Meal) => b.served_on.localeCompare(a.served_on)

/**
 * 뷰 행(가족·식사별 잔량)과 식사 목록을 홈 화면 구역으로 나눈다.
 * - 오늘: 오늘 날짜의 식사는 식권이 없어도 보여 준다 ("식권이 없어요" 안내용)
 * - 다가오는: 식권이 있는 미래 식사, 가까운 순
 * - 지난: 발급이 있었던 과거 식사, 최근 순 (미사용 장수 표시용)
 */
export function groupTickets(meals: readonly Meal[], balances: readonly Balance[], today: string): TicketGroups {
  const mealById = new Map(meals.map((m) => [m.id, m]))
  const balanceByMeal = new Map<string, Balance>()
  for (const b of balances) if (b.meal_id) balanceByMeal.set(b.meal_id, b)

  const toGroup = (meal: Meal): TicketGroup => {
    const b = balanceByMeal.get(meal.id)
    return { meal, issued: b?.issued ?? 0, used: b?.used ?? 0, remaining: b?.remaining ?? 0, amount: b?.amount ?? 0 }
  }
  const withTickets = [...balanceByMeal.keys()].map((id) => mealById.get(id)).filter((m): m is Meal => m !== undefined)

  return {
    today: meals.filter((m) => m.served_on === today).toSorted(byTitle).map(toGroup),
    upcoming: withTickets.filter((m) => m.served_on > today).toSorted(byDateAsc).map(toGroup),
    past: withTickets
      .filter((m) => m.served_on < today)
      .toSorted(byDateDesc)
      .map(toGroup)
      .filter((g) => g.issued > 0),
  }
}
