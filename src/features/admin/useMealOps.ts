import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { mealDetailQueryKey } from './useMealDetail'
import { adminBalancesQueryKey } from './useMeals'

/**
 * 식권 조작 뒤 다시 읽어야 하는 것 전부: 이 식사의 현황, 관리자 식사 카드 합계,
 * (관리자 본인 가족에게 한 조작일 수도 있으니) 식권·내역. 순서는 테스트가 그대로 단언한다.
 */
export function invalidateMealOps(queryClient: QueryClient, mealId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
  ])
}

// 네 조회가 각자 스냅샷이라 화면의 남은 장수가 잠깐 낡을 수 있다 → 서버가 거부하면(would_go_negative·no_remaining 등)
// 현황을 바로 다시 읽어 버튼 잠금이 실제 잔량을 따르게 한다 (Task 1 리뷰).
const refreshBoard = (queryClient: QueryClient, mealId: string) => () => queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) })

/** 발급 한 건 취소. 사유 입력 칸은 4a 에 두지 않는다(DB 의 p_reason 은 선택 인자). */
export function useCancelIssuance(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (issuanceId: string) => unwrap(await supabase.rpc('cancel_issuance', { p_issuance_id: issuanceId })),
    // promise 를 돌려줘야 재조회가 끝날 때까지 isPending 이 유지된다
    onSuccess: () => invalidateMealOps(queryClient, mealId),
    onError: refreshBoard(queryClient, mealId),
  })
}

export function useVoidUsage(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (usageId: string) => unwrap(await supabase.rpc('void_usage', { p_usage_id: usageId })),
    onSuccess: () => invalidateMealOps(queryClient, mealId),
  })
}

export type AdminUseArgs = { personId: string; familyId: string }

/** 담당자가 교인 폰 없이 1장 사용 처리. personId 는 "누구 몫"(가족 블록의 산 사람), familyId 는 화면이 본 가족 — 그 사이 옮겼으면 서버가 family_changed 로 거부한다. */
export function useUseTicketAsAdmin(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ personId, familyId }: AdminUseArgs) =>
      unwrap(await supabase.rpc('use_ticket_as_admin', { p_person_id: personId, p_meal_id: mealId, p_family_id: familyId })),
    onSuccess: () => invalidateMealOps(queryClient, mealId),
    onError: refreshBoard(queryClient, mealId),
  })
}
