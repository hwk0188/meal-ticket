import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'

/** 연결 대기 중 "내 사람 행이 생겼나(또는 가족이 바뀌었나)" 를 확인하는 주기 */
export const PAIR_POLL_MS = 3_000

export type PairingKind = 'child' | 'adult'
export type PairingCode = { code: string; expires_at: string }
export const pairingCodeQueryKey = (kind: PairingKind) => ['pairing-code', kind] as const

/**
 * 연결 코드를 받는다. 조회처럼 다루되(화면이 열릴 때 한 번) 자동 재조회는 모두 끈다 — 서버는 부를 때마다
 * 이전 코드를 지우고 새 코드를 만들기 때문에, 포커스 복귀만으로 코드가 바뀌면 보호자가 적던 코드가 무효가 된다.
 * 새 코드는 사용자가 "새 코드 받기"(refetch) 를 눌러 받는다. 화면을 떠나면 캐시도 버린다(gcTime 0).
 */
export function usePairingCode(kind: PairingKind) {
  return useQuery({
    queryKey: pairingCodeQueryKey(kind),
    queryFn: async (): Promise<PairingCode> => {
      const rows = unwrap(await supabase.rpc('create_pairing_code', { p_kind: kind }))
      const row = rows[0]
      if (!row) throw new Error('usePairingCode: 코드를 받지 못했습니다')
      return row
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  })
}
