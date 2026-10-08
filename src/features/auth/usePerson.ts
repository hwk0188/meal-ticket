import { useQuery } from '@tanstack/react-query'
import type { Database } from '../../lib/database.types'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'

export type Person = Database['public']['Tables']['people']['Row']

export const personQueryKey = (userId: string | undefined) => ['person', userId] as const

/** 로그인한 계정에 연결된 사람 행. 없으면 null (가입 전). */
export function usePerson(userId: string | undefined) {
  return useQuery({
    queryKey: personQueryKey(userId),
    enabled: Boolean(userId),
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
