import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'

/** 연결 대기 중 "내 사람 행이 생겼나(또는 가족이 바뀌었나)" 를 확인하는 주기 */
export const PAIR_POLL_MS = 3_000

// create_pairing_code 의 interval '10 minutes' 와 같아야 한다
export const PAIR_CODE_TTL_MS = 10 * 60_000

export type PairingKind = 'child' | 'adult'
export type PairingCode = { code: string; expires_at: string }
export const pairingCodeQueryKey = (kind: PairingKind) => ['pairing-code', kind] as const

/**
 * 연결 코드를 받는다. 조회처럼 다루되(화면이 열릴 때 한 번) 자동 재조회는 모두 끈다 — 서버는 부를 때마다
 * 이전 코드를 지우고 새 코드를 만들기 때문에, 포커스 복귀만으로 코드가 바뀌면 보호자가 적던 코드가 무효가 된다.
 * 새 코드는 사용자가 "새 코드 받기"(refetch) 를 눌러 받는다.
 *
 * gcTime 은 0 이 아니라 PAIR_CODE_TTL_MS 다 — 서버는 부를 때마다 이전 코드를 지우므로, 리마운트(개발 모드의
 * StrictMode 이중 마운트, Task 12 의 세그먼트 컨트롤이 카드를 넣다 뺐다 하는 경우)가 조용히 새 코드를 또
 * 발급받게 두면 안 되고 아직 살아 있는 같은 코드를 다시 보여 줘야 한다. staleTime: Infinity 와 함께라면
 * TTL 안의 리마운트는 캐시된 코드를 그대로 쓰고, 이미 만료된 코드는 만료된 채로 보여 주다가 사용자가
 * "새 코드 받기" 를 눌러야 비로소 새로 받는다. 계정 간 캐시가 섞이는 문제는 AuthProvider 가 로그아웃 때
 * queryClient 를 비우는 것으로 막는다.
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
    gcTime: PAIR_CODE_TTL_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  })
}
