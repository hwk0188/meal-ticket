import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Meal } from '../tickets/groupTickets'
import { groupMealLedger, type MealLedger } from './groupMealLedger'

/** 화면이 보이는 동안의 재조회 주기 (설계 §8.3 식사 상세 5초 폴링). 숨겨지면 멈추고 돌아오면 즉시 다시 읽는다. */
export const MEAL_DETAIL_POLL_MS = 5_000

export const mealDetailQueryKey = (mealId: string) => ['meal-detail', mealId] as const

// 손으로 고친 주소(#/admin/meals/zzz)는 PostgREST 가 22P02(400 부적합 입력) 로 응답하므로, 쿼리 전에 걸러 "없는 식사" 로 다룬다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다 (useFamilyLedger 와 같은 규칙).
// buyer·person 은 탈퇴 여부(deleted_at)도 받는다 — buyerId 가 탈퇴자를 가리키지 않게. issuer 는 버튼 대상이 아니라 이름만.
const ISSUANCE_SELECT =
  'id, person_id, family_id, quantity, unit_price, memo, issued_at, cancelled_at, cancel_reason, buyer:people!issuances_person_id_fkey(name, deleted_at), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, person_id, family_id, used_at, used_via, voided_at, person:people!usages_person_id_fkey(name, deleted_at)'

export type MealDetail = { meal: Meal; ledger: MealLedger }

/** 식사 하나의 현황. 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다. 식사가 없으면 null. */
export function useMealDetail(mealId: string) {
  return useQuery({
    queryKey: mealDetailQueryKey(mealId),
    queryFn: async (): Promise<MealDetail | null> => {
      if (!UUID.test(mealId)) return null
      // 네 요청은 각자 스냅샷이라(트랜잭션 없음) 잠깐 발급 줄과 합계가 어긋날 수 있다 — 5초 폴링으로 곧 맞는다. 조작의 판단(취소 가능 여부 등)은 서버가 한다.
      // LIMIT 없이 식사 하나의 장부 전체를 5초마다 읽는다 — 가족 수백 규모에서 폴링당 수십 KB. 무료 플랜 전송량 안에서 감당하기로 한 결정(4a 계획 Task 7).
      const [meal, issuances, usages, balances] = await Promise.all([
        // queryFn 문맥 타입과 maybeSingle 의 제네릭 추론이 부딪히므로(useLatestUnitPrice 참고) unwrap 에 타입 인자를 준다
        supabase.from('meals').select('*').eq('id', mealId).maybeSingle().then((r) => unwrap<Meal | null>(r)),
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('meal_id', mealId).order('issued_at', { ascending: false }).then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('meal_id', mealId).order('used_at', { ascending: false }).then(unwrap),
        supabase.from('ticket_balances').select('*').eq('meal_id', mealId).then(unwrap),
      ])
      if (!meal) return null
      // 두 select 문자열은 MealIssuanceRow·MealUsageRow 와 구조적으로 일치한다 (tsc 가 검증)
      return { meal, ledger: groupMealLedger(issuances, usages, balances) }
    },
    refetchInterval: MEAL_DETAIL_POLL_MS,
  })
}
