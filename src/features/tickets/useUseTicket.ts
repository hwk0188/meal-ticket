import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { rpcCodeOf } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ticketsQueryKey } from './useFamilyTickets'

/** 누름 완료 뒤 응답을 기다리는 한계 (설계 §9). 넘기면 "통신이 불안정해요" 를 띄우고, 다음 누름은 같은 request_id 로 재시도한다. */
export const USE_TIMEOUT_MS = 5_000

/**
 * 식권 1장 사용. request_id 는 "한 번의 시도" 를 뜻한다:
 *  - 서버가 판정을 내리면(성공 또는 no_remaining 같은 코드) 시도가 끝난 것이라 다음엔 새 id
 *  - 통신 오류·타임아웃이면 서버에 닿았는지 모르므로 같은 id 로 재시도 (서버가 멱등 처리 → 이중 차감 없음)
 */
export function useUseTicket(mealId: string) {
  const queryClient = useQueryClient()
  const requestId = useRef<string | null>(null)

  return useMutation({
    mutationFn: async () => {
      const id = requestId.current ?? (requestId.current = crypto.randomUUID())
      const { signal, done } = withTimeout(USE_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('use_ticket', { p_meal_id: mealId, p_request_id: id }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => {
      requestId.current = null
    },
    onError: (err) => {
      if (rpcCodeOf(err)) requestId.current = null
    },
    // 성공이든 실패든 잔량을 다시 읽는다 (no_remaining 이면 다른 폰이 쓴 것이라 목록이 바뀌어 있다)
    onSettled: () => queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
  })
}
