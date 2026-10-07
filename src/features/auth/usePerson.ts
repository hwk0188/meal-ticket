import { useQuery } from '@tanstack/react-query'
import type { Database } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'

export type Person = Database['public']['Tables']['people']['Row']

export const personQueryKey = (userId: string | undefined) => ['person', userId] as const

/** 로그인한 계정에 연결된 사람 행. 없으면 null (가입 전). */
export function usePerson(userId: string | undefined) {
  return useQuery({
    queryKey: personQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Person | null> => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('auth_user_id', userId)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
