import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { monthRange } from './statsMonth'

export const MONTH_LEDGER_QUERY_KEY = ['month-ledger'] as const
export const monthLedgerQueryKey = (month: string) => [...MONTH_LEDGER_QUERY_KEY, month] as const

/**
 * 한 달에 읽는 최대 행 수(표마다). PostgREST 의 `max_rows`(supabase/config.toml, 호스팅 기본값도 1000) 와 같은
 * 값을 명시해 둔다 — 넘으면 오류 없이 잘려서 합계가 조용히 작아지고 CSV 에 빠진 행이 생긴다.
 * 교회 규모(한 달에 식사 4~5회)에서는 닿지 않지만, 닿는 순간을 화면이 알려야 한다.
 */
export const MAX_LEDGER_ROWS = 1000

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// FK 가 여럿이라 임베딩에 제약 이름 힌트가 필요하다(Postgres 기본 규칙 <표>_<열>_fkey). `meals!inner` 는
// 조인을 강제한다 — 바깥 조인이면 meal.served_on 필터가 행을 지우지 못하고 meal 이 null 인 행이 남는다.
const ISSUANCE_SELECT =
  'id, family_id, quantity, unit_price, memo, issued_at, cancelled_at, cancel_reason, meal:meals!inner(id, title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name), canceller:people!issuances_cancelled_by_fkey(name)'
const USAGE_SELECT =
  'id, family_id, quantity, used_at, used_via, voided_at, meal:meals!inner(id, title, served_on), person:people!usages_person_id_fkey(name), recorder:people!usages_recorded_by_fkey(name), voider:people!usages_voided_by_fkey(name)'

type NameRef = { name: string } | null
// 식사별 행은 식사 id 로 묶는다 — (served_on, title) 조합에 유일 제약이 있어도 파생 키보다 id 가 정직하다.
type MealRef = { id: string; title: string; served_on: string }

export type MonthIssuanceRow = {
  id: string
  family_id: string
  quantity: number
  unit_price: number
  memo: string | null
  issued_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
  canceller: NameRef
}
export type MonthUsageRow = {
  id: string
  family_id: string
  quantity: number
  used_at: string
  used_via: string // DB 는 check 제약뿐인 text — 'self' | 'admin' 리터럴이 아니다
  voided_at: string | null
  meal: MealRef
  person: NameRef
  recorder: NameRef
  voider: NameRef
}
export type MonthLedger = {
  issuances: MonthIssuanceRow[]
  usages: MonthUsageRow[]
  /** 어느 한쪽이라도 천장에 닿았다 — 화면이 "일부만 보여요" 를 띄운다. */
  truncated: boolean
}

const EMPTY: MonthLedger = { issuances: [], usages: [], truncated: false }

/**
 * 그 달 **식사일**의 발급·사용 원본 행. 취소·무효 행도 CSV 에 들어가므로 걸러내지 않는다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다(교인이 주소를 쳐도 자기 가족만 온다).
 */
export function useMonthLedger(month: string) {
  return useQuery({
    queryKey: monthLedgerQueryKey(month),
    queryFn: async (): Promise<MonthLedger> => {
      if (!MONTH_RE.test(month)) return EMPTY
      const { from, to } = monthRange(month)
      const [issuances, usages] = await Promise.all([
        supabase
          .from('issuances')
          .select(ISSUANCE_SELECT)
          .gte('meal.served_on', from)
          .lte('meal.served_on', to)
          .order('issued_at', { ascending: false })
          .order('id')
          .limit(MAX_LEDGER_ROWS)
          .then(unwrap),
        supabase
          .from('usages')
          .select(USAGE_SELECT)
          .gte('meal.served_on', from)
          .lte('meal.served_on', to)
          .order('used_at', { ascending: false })
          .order('id')
          .limit(MAX_LEDGER_ROWS)
          .then(unwrap),
      ])
      return {
        issuances,
        usages,
        truncated: issuances.length >= MAX_LEDGER_ROWS || usages.length >= MAX_LEDGER_ROWS,
      }
    },
  })
}
