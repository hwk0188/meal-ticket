import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { mergeLedger, type LedgerEntry } from '../history/mergeLedger'

export const personLedgerQueryKey = (personId: string) => ['person-ledger', personId] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 표마다 최근 100건씩 — 한 사람 기준으로는 넉넉하다 (useFamilyLedger 와 같은 전제).
const LIMIT = 100
// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다.
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, cancel_reason, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, used_at, used_via, voided_at, meal:meals(title, served_on), person:people!usages_person_id_fkey(name)'

/** 그 사람 이름으로 된 발급·사용 이력 (가족이 아니라 사람 기준 — 합치기 뒤에는 합쳐진 쪽 이력까지 보인다). */
export function usePersonLedger(personId: string) {
  return useQuery({
    queryKey: personLedgerQueryKey(personId),
    queryFn: async (): Promise<LedgerEntry[]> => {
      if (!UUID.test(personId)) return []
      const [issuances, usages] = await Promise.all([
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('person_id', personId).order('issued_at', { ascending: false }).order('id').limit(LIMIT).then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('person_id', personId).order('used_at', { ascending: false }).order('id').limit(LIMIT).then(unwrap),
      ])
      return mergeLedger(issuances, usages)
    },
  })
}
