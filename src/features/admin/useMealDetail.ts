import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Meal } from '../tickets/groupTickets'
import { groupMealLedger, type MealLedger } from './groupMealLedger'

/** 화면이 보이는 동안의 재조회 주기 (설계 §8.3 식사 상세 5초 폴링). 숨겨지면 멈추고 돌아오면 즉시 다시 읽는다. */
export const MEAL_DETAIL_POLL_MS = 5_000

export const mealDetailQueryKey = (mealId: string) => ['meal-detail', mealId] as const

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다 (useFamilyLedger 와 같은 규칙).
const ISSUANCE_SELECT =
  'id, person_id, family_id, quantity, unit_price, memo, issued_at, cancelled_at, cancel_reason, buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, person_id, family_id, used_at, used_via, voided_at, person:people!usages_person_id_fkey(name)'

export type MealDetail = { meal: Meal; ledger: MealLedger }

/** 식사 하나의 현황. 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다. 식사가 없으면 null. */
export function useMealDetail(mealId: string) {
  return useQuery({
    queryKey: mealDetailQueryKey(mealId),
    queryFn: async (): Promise<MealDetail | null> => {
      const [meal, issuances, usages, balances] = await Promise.all([
        // queryFn 문맥 타입과 maybeSingle 의 제네릭 추론이 부딪히므로(useLatestUnitPrice 참고) unwrap 에 타입 인자를 준다
        supabase.from('meals').select('*').eq('id', mealId).maybeSingle().then((r) => unwrap<Meal | null>(r)),
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('meal_id', mealId).then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('meal_id', mealId).then(unwrap),
        supabase.from('ticket_balances').select('*').eq('meal_id', mealId).then(unwrap),
      ])
      if (!meal) return null
      // 두 select 문자열은 MealIssuanceRow·MealUsageRow 와 구조적으로 일치한다 (tsc 가 검증)
      return { meal, ledger: groupMealLedger(issuances, usages, balances) }
    },
    refetchInterval: MEAL_DETAIL_POLL_MS,
  })
}
