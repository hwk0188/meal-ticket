import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'
import { mergeLedger } from './mergeLedger'

export const ledgerQueryKey = ['ledger'] as const

// 표마다 최근 100건씩(합치면 최대 200건) — 가족 단위로는 넉넉하다. 전체 이력이 아니라 최근 내역 화면이라는 전제.
const LIMIT = 100

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다. 제약 이름은 Postgres 기본 규칙(<표>_<열>_fkey).
// cancel_reason 은 일부러 빼 둔다 — 관리자가 적은 자유 서술이고, 화면에 안 그려도 select 에 두면
// 교인 브라우저가 받는 JSON 에 담긴다. 관리자 조회(usePersonLedger)만 읽는다 (설계 §10).
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, used_at, used_via, voided_at, meal:meals(title, served_on), person:people!usages_person_id_fkey(name)'

/** 우리 가족의 발급·사용 내역 (최근 100건씩). 관리자도 이 화면에선 자기 가족만 보도록 family_id 로 좁힌다. */
export function useFamilyLedger(person: Person) {
  return useQuery({
    queryKey: [...ledgerQueryKey, person.family_id],
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
      // 두 select 문자열 모두 IssuanceRow·UsageRow 와 구조적으로 일치한다(캐스트 불필요 — tsc 가 그대로 검증).
      return mergeLedger(issuances, usages)
    },
  })
}
