import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

export const personDetailQueryKey = (personId: string) => ['person-detail', personId] as const

/** 손으로 고친 주소(#/admin/people/zzz)는 PostgREST 22P02(400) 가 되므로 미리 "없는 사람" 으로 본다 (4a useMealDetail 과 같은 가드). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FAMILY_COLUMNS = 'id, name, phone, is_minor, guardian_id, auth_user_id, role, deleted_at'

export type FamilyMemberRow = Pick<Person, 'id' | 'name' | 'phone' | 'is_minor' | 'guardian_id' | 'auth_user_id' | 'role' | 'deleted_at'>
export type PersonDetail = { person: Person; family: FamilyMemberRow[] }

/**
 * 사람 한 명과 같은 가족 구성원. 익명화된 행(`deleted_at`)도 그대로 읽는다 —
 * 초기화·합치기 직후 화면이 "없는 사람" 으로 튀지 않고 "초기화됨" 상태를 보여 줄 수 있어야 한다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다.
 */
export function usePersonDetail(personId: string) {
  return useQuery({
    queryKey: personDetailQueryKey(personId),
    queryFn: async (): Promise<PersonDetail | null> => {
      if (!UUID.test(personId)) return null
      // queryFn 문맥 타입과 maybeSingle 의 제네릭 추론이 부딪히므로 unwrap 에 타입 인자를 준다 (useLatestUnitPrice 참고)
      const person = await supabase.from('people').select('*').eq('id', personId).maybeSingle().then((r) => unwrap<Person | null>(r))
      if (!person) return null
      const family = await supabase.from('people').select(FAMILY_COLUMNS).eq('family_id', person.family_id).order('created_at').order('id').then(unwrap)
      return { person, family }
    },
  })
}
