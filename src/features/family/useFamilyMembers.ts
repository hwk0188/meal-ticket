import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

export const familyMembersQueryKey = ['family-members'] as const
const COLUMNS = 'id, name, phone, is_minor, guardian_id, auth_user_id, consented_at, guardian_consented_at, created_at'

export type FamilyMember = Pick<Person, 'id' | 'name' | 'phone' | 'is_minor' | 'guardian_id' | 'auth_user_id' | 'consented_at' | 'guardian_consented_at' | 'created_at'>

/** 내 가족의 살아 있는 구성원 (RLS 가 같은 가족만 연다). 가입 순. */
export function useFamilyMembers(familyId: string) {
  return useQuery({
    queryKey: [...familyMembersQueryKey, familyId],
    queryFn: async (): Promise<FamilyMember[]> =>
      supabase.from('people').select(COLUMNS).eq('family_id', familyId).is('deleted_at', null).order('created_at').then(unwrap),
  })
}

/** 나도 아니고 내 자녀도 아닌 구성원이 있는가. DB 의 leave_family 도 같은 조건에서만 옮기므로, "가족 나가기" 는 이때만 보인다. */
export function canLeaveFamily(members: readonly FamilyMember[], meId: string): boolean {
  return members.some((m) => m.id !== meId && !(m.is_minor && m.guardian_id === meId))
}
