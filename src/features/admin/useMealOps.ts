import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { rpcCodeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { mealDetailQueryKey } from './useMealDetail'
import { adminBalancesQueryKey } from './useMeals'
import { PERSON_LEDGER_QUERY_KEY } from './usePersonLedger'

/** RPC 응답 대기 한계. 넘기면 요청을 끊어 버튼이 영원히 '처리 중…' 에 머무르지 않게 한다 (useUseTicket 과 같은 패턴, 다른 값). */
export const OPS_TIMEOUT_MS = 8_000

/**
 * 식권 조작 뒤 다시 읽어야 하는 것 전부: 이 식사의 현황, 관리자 식사 카드 합계,
 * (관리자 본인 가족에게 한 조작일 수도 있으니) 식권·내역, (관리자 사람 상세를 보고 있었을 수도 있으니) 사람 이력.
 * 순서는 테스트가 그대로 단언한다.
 */
export function invalidateMealOps(queryClient: QueryClient, mealId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    // 어떤 사람의 이력인지 몰라도(취소·무효는 issuanceId·usageId 만 받는다) 접두사로 전부 — personLedgerQueryKey 전체를 덮는다.
    queryClient.invalidateQueries({ queryKey: PERSON_LEDGER_QUERY_KEY }),
  ])
}

/** 성공 뒤 현황 재조회를 기다리는 한도. 넘으면 버튼을 먼저 풀어 준다 — 5초 폴링이 뒤따라 맞춘다.
 *  (재조회에는 AbortSignal 이 없어 끊긴 연결에서 수십 초 매달릴 수 있다 — 최종 리뷰) */
export const SETTLE_TIMEOUT_MS = 3_000

const settleBoard = (queryClient: QueryClient, mealId: string) =>
  Promise.race([invalidateMealOps(queryClient, mealId), new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))])

// 서버가 판단한 거부(코드 있음)일 때만 현황을 다시 읽는다 — 통신 실패 때 재조회까지 기다리면 오류 문구가 늦거나(오프라인이면 영영) 안 보인다.
// 같은 이유로 await 되는 onError 안에서 하므로 "현황을 다시 불러왔어요" 문구가 사실이 된다.
const makeRefreshBoard = (queryClient: QueryClient, mealId: string) => (err: unknown) =>
  rpcCodeOf(err) ? queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) }) : undefined

export type CancelArgs = { issuanceId: string; reason: string }

/** 발급 한 건 취소. 사유는 선택 — 비면 보내지 않는다(DB 의 p_reason 은 기본값 null). */
export function useCancelIssuance(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ issuanceId, reason }: CancelArgs) => {
      const trimmed = reason.trim()
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(
          await supabase
            .rpc('cancel_issuance', trimmed === '' ? { p_issuance_id: issuanceId } : { p_issuance_id: issuanceId, p_reason: trimmed })
            .abortSignal(signal),
        )
      } finally {
        done()
      }
    },
    // promise 를 돌려줘야 재조회가 끝날 때까지 isPending 이 유지된다
    onSuccess: () => settleBoard(queryClient, mealId),
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

export function useVoidUsage(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (usageId: string) => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('void_usage', { p_usage_id: usageId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => settleBoard(queryClient, mealId),
    // already_voided·usage_not_found 도 "화면이 낡았다" 는 뜻 — cancel 과 똑같이 현황을 다시 읽는다.
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

export type AdminUseArgs = { personId: string; familyId: string }

/** 담당자가 교인 폰 없이 1장 사용 처리. personId 는 "누구 몫"(가족 블록의 산 사람), familyId 는 화면이 본 가족 — 그 사이 옮겼으면 서버가 family_changed 로 거부한다. */
export function useUseTicketAsAdmin(mealId: string) {
  const queryClient = useQueryClient()
  // 재시도 키: 대상(식사·사람·가족)마다 하나씩 들고 있는다(한 훅 인스턴스가 여러 가족 블록을 처리하므로, 슬롯 하나였다면
  // 다른 대상을 처리하는 사이 먼저 걸려 있던 재시도 id 를 덮어써 버린다). 서버가 판단한 응답(성공 또는 코드 있는 오류)이
  // 오면 그 대상의 id 를 버린다; 통신 실패·타임아웃이면 남겨 둔다(use_ticket 과 같은 규칙).
  const retry = useRef(new Map<string, string>())
  return useMutation({
    mutationFn: async ({ personId, familyId }: AdminUseArgs) => {
      const key = `${mealId}:${personId}:${familyId}`
      const requestId = retry.current.get(key) ?? crypto.randomUUID()
      retry.current.set(key, requestId)
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        const row = unwrap(
          await supabase
            .rpc('use_ticket_as_admin', { p_person_id: personId, p_meal_id: mealId, p_family_id: familyId, p_request_id: requestId })
            .abortSignal(signal),
        )
        retry.current.delete(key)
        return row
      } catch (err) {
        if (rpcCodeOf(err)) retry.current.delete(key)
        throw err
      } finally {
        done()
      }
    },
    onSuccess: () => settleBoard(queryClient, mealId),
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

/** 현황판 동작 오류 문구. no_remaining 은 교인 폰 문구("방금 다른 폰에서…")가 아니라 관리자 맥락으로. */
export function mealOpsErrorMessage(err: unknown): string {
  return rpcCodeOf(err) === 'no_remaining' ? '남은 식권이 없어요. 현황을 다시 불러왔어요.' : toUserMessage(err)
}
