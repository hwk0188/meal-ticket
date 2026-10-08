import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router'
import type { Database } from '../../lib/database.types'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'

export type Person = Database['public']['Tables']['people']['Row']

export const personQueryKey = (userId: string | undefined) => ['person', userId] as const

export type UsePersonOptions = {
  /** 연결 코드 화면·가족 합류 대기처럼 "내 사람 행이 생기거나 바뀌기를" 기다릴 때만 준다. 기본은 없음. */
  refetchInterval?: number | false
}

/**
 * 로그인한 계정에 연결된 사람 행. 없으면 null (가입 전).
 * 이 주기로 다시 읽은 결과를 같은 키의 다른 관찰자(가드)도 함께 받는다
 * (관찰자마다 타이머는 따로이고, 가드는 타이머 없이 공유 Query 의 갱신만 받는다).
 */
export function usePerson(userId: string | undefined, { refetchInterval = false }: UsePersonOptions = {}) {
  return useQuery({
    queryKey: personQueryKey(userId),
    enabled: Boolean(userId),
    refetchInterval,
    queryFn: async (): Promise<Person | null> => {
      // enabled 가 막아 주지만, 키 없이 호출되면 조용히 null 을 돌려주는 대신 드러낸다.
      if (!userId) throw new Error('usePerson: userId 없이 조회할 수 없습니다')
      const result = await supabase
        .from('people')
        .select('*')
        .eq('auth_user_id', userId)
        // 제약으로 이미 보장되지만(살아 있는 행만 auth_user_id 를 가진다) 이중 방어로 둔다.
        .is('deleted_at', null)
        .maybeSingle()
      return unwrap(result)
    },
  })
}

/** RequirePerson 레이아웃 아래 화면에서 현재 사람을 받는다 (Outlet context). */
export function useCurrentPerson(): Person {
  const person = useOutletContext<Person | null>()
  if (!person) throw new Error('useCurrentPerson은 RequirePerson 아래에서만 쓸 수 있습니다')
  return person
}
