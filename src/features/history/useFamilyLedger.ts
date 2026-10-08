import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'
import { mergeLedger, type UsageRow } from './mergeLedger'

const LIMIT = 100

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다. 제약 이름은 Postgres 기본 규칙(<표>_<열>_fkey).
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, used_at, used_via, voided_at, meal:meals(title, served_on), person:people!usages_person_id_fkey(name)'

/** 우리 가족의 발급·사용 내역 (최근 100건씩). 관리자도 이 화면에선 자기 가족만 보도록 family_id 로 좁힌다. */
export function useFamilyLedger(person: Person) {
  return useQuery({
    queryKey: ['ledger', person.family_id],
    queryFn: async () => {
      const [issuances, usages] = await Promise.all([
        supabase
          .from('issuances')
          .select(ISSUANCE_SELECT)
          .eq('family_id', person.family_id)
          .order('issued_at', { ascending: false })
          .limit(LIMIT)
          .then(unwrap),
        supabase
          .from('usages')
          .select(USAGE_SELECT)
          .eq('family_id', person.family_id)
          .order('used_at', { ascending: false })
          .limit(LIMIT)
          .then(unwrap),
      ])
      // issuances 는 select 문자열만으로 IssuanceRow 와 정확히 일치한다(캐스트 불필요).
      // usages 는 used_via 가 DB 상 check 제약뿐인 text 라 Database 타입에서 string 으로만 추론돼
      // 'self' | 'admin' 리터럴과 안 맞는다 — 그 한 필드 때문에 배열 전체를 좁혀야 해서 캐스트를 남긴다.
      return mergeLedger(issuances, usages as UsageRow[])
    },
  })
}
