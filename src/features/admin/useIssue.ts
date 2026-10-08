import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import type { IssueValues } from './issueSchema'
import { adminBalancesQueryKey } from './useMeals'

export const latestUnitPriceQueryKey = ['latest-unit-price'] as const

/** 같은 사람·식사·장수 발급이 이 시간 안에 있으면 확인 창을 띄운다 (설계 §8.3 중복 방어) */
export const DUPLICATE_WINDOW_MS = 60_000

/** 누구에게든 가장 최근에 발급한 (유료·취소되지 않은) 단가. 이월(0원)·취소된 발급은 기본값 후보에서 뺀다 — 첫 발급이면 null (칸을 비워 둔다). */
export function useLatestUnitPrice() {
  return useQuery({
    queryKey: latestUnitPriceQueryKey,
    queryFn: async () => {
      // useQuery 의 queryFn 문맥 타입(QueryFunction<TData>)이 안쪽 unwrap(await …) 의 제네릭 추론과
      // 부딪혀 T 가 never 로 무너진다 — unwrap 에 타입 인자를 직접 줘서 추론을 건너뛴다.
      const row = unwrap<{ unit_price: number } | null>(
        await supabase
          .from('issuances')
          .select('unit_price')
          .gt('unit_price', 0)
          .is('cancelled_at', null)
          .order('issued_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )
      return row?.unit_price ?? null
    },
  })
}

export async function findRecentDuplicate(args: { personId: string; mealId: string; quantity: number }): Promise<boolean> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const rows = unwrap(
    await supabase
      .from('issuances')
      .select('id')
      .eq('person_id', args.personId)
      .eq('meal_id', args.mealId)
      .eq('quantity', args.quantity)
      .is('cancelled_at', null)
      .gte('issued_at', since)
      .limit(1),
  )
  return rows.length > 0
}

export type IssueArgs = IssueValues & { personId: string; mealId: string }

export function useIssueTickets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: IssueArgs) =>
      unwrap(
        await supabase.rpc('issue_tickets', {
          p_person_id: args.personId,
          p_meal_id: args.mealId,
          p_quantity: args.quantity,
          p_unit_price: args.unitPrice,
          // 생성 타입에서 p_memo 는 선택 인자(string, null 이 아님)라 null 대신 undefined 를 보낸다(생략과 같다).
          p_memo: args.memo ?? undefined,
        }),
      ),
    // promise 를 돌려줘야 재조회가 끝날 때까지 isPending 이 유지된다
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
        queryClient.invalidateQueries({ queryKey: latestUnitPriceQueryKey }),
        // 관리자 본인 가족에게 발급했을 수도 있다 (식권·내역 모두)
        queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
      ]),
  })
}
