import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { decoratePeople, type DecoratedPerson } from './peopleFilter'

export const allPeopleQueryKey = ['all-people'] as const

const COLUMNS = 'id, family_id, name, phone, auth_user_id, role, is_minor, guardian_id, created_at'

/**
 * 살아 있는 사람 전부. 교인 수가 수백 규모라 한 번에 읽고 검색·필터·가족 수는 클라이언트에서 한다
 * (설계 §2 의 규모 가정). 수천 명이 되면 `usePeopleSearch` 처럼 서버 검색으로 바꾼다.
 * 익명화된 행(탈퇴·삭제·합쳐진 사람)은 이름이 모두 같아 검색을 방해하므로 빼고 읽는다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다.
 */
export function useAllPeople() {
  return useQuery({
    queryKey: allPeopleQueryKey,
    staleTime: 30_000,
    queryFn: async (): Promise<DecoratedPerson[]> =>
      decoratePeople(await supabase.from('people').select(COLUMNS).is('deleted_at', null).order('name').then(unwrap)),
  })
}
