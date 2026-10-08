import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { rpcCodeOf } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import type { Usage } from './groupTickets'
import { ticketsQueryKey } from './useFamilyTickets'

/** 누름 완료 뒤 응답을 기다리는 한계 (설계 §9). 넘기면 "통신이 불안정해요" 를 띄우고, 다음 누름은 같은 request_id 로 재시도한다. */
export const USE_TIMEOUT_MS = 5_000

/**
 * 식권 1장 사용. request_id 는 "한 번의 시도" 를 뜻한다:
 *  - 서버가 판정을 내리면(성공 또는 no_remaining 같은 코드) 시도가 끝난 것이라 다음엔 새 id
 *  - 통신 오류·타임아웃이면 서버에 닿았는지 모르므로 같은 id 로 재시도 (서버가 멱등 처리 → 이중 차감 없음)
 *
 * 한 인스턴스는 한 번에 한 시도만 처리한다 — 겹친 호출은 같은 시도를 기다린다. UI 도 isPending 동안 모든 행을 disabled 로 둔다.
 */
export function useUseTicket(mealId: string) {
  const queryClient = useQueryClient()
  // 식사별로 request_id 를 들고 있는다 — 다른 식사로 바뀌면(이론상 이 훅은 식사 id 로 키가 잡혀 다시 안 생기지만,
  // 혹시 몰라) 묵은 id 를 재사용하지 않는다.
  const requestId = useRef<{ mealId: string; id: string } | null>(null)
  // 같은 인스턴스에 겹쳐 들어온 mutate() 호출(React 가 isPending 을 반영하기 전의 연타 등)이 서로 다른
  // request_id 로 중복 호출되지 않도록, 진행 중인 시도를 하나만 두고 나머지는 그 결과를 같이 기다린다.
  const inFlight = useRef<Promise<Usage> | null>(null)

  async function attempt(): Promise<Usage> {
    if (requestId.current?.mealId !== mealId) requestId.current = { mealId, id: crypto.randomUUID() }
    const id = requestId.current.id
    const { signal, done } = withTimeout(USE_TIMEOUT_MS)
    try {
      return unwrap(await supabase.rpc('use_ticket', { p_meal_id: mealId, p_request_id: id }).abortSignal(signal))
    } finally {
      done()
    }
  }

  return useMutation({
    mutationFn: () =>
      (inFlight.current ??= attempt().finally(() => {
        inFlight.current = null
      })),
    onSuccess: () => {
      requestId.current = null
    },
    onError: (err) => {
      if (rpcCodeOf(err)) requestId.current = null
    },
    // 성공이든 실패든 잔량을 다시 읽는다 (no_remaining 이면 다른 폰이 쓴 것이라 목록이 바뀌어 있다)
    // 내역 화면도 같이 무효화한다 — 사용 성공은 usages 테이블에 새 행을 만들므로 내역에도 바로 보여야 한다.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey })
      void queryClient.invalidateQueries({ queryKey: ledgerQueryKey })
    },
  })
}
