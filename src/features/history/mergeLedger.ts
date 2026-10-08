type MealRef = { title: string; served_on: string } | null
type NameRef = { name: string } | null

/** issuances 에 meals·people 을 임베딩한 행 (select 문자열은 useFamilyLedger 참고) */
export type IssuanceRow = {
  id: string
  issued_at: string
  quantity: number
  unit_price: number
  memo: string | null
  cancelled_at: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
}
export type UsageRow = {
  id: string
  used_at: string
  used_via: 'self' | 'admin'
  voided_at: string | null
  meal: MealRef
  person: NameRef
}

export type IssuanceEntry = {
  kind: 'issuance'; id: string; at: string; mealTitle: string; servedOn: string
  quantity: number; amount: number; buyer: string; issuer: string; memo: string | null; cancelled: boolean
}
export type UsageEntry = {
  kind: 'usage'; id: string; at: string; mealTitle: string; servedOn: string
  person: string; via: 'self' | 'admin'; voided: boolean
}
export type LedgerEntry = IssuanceEntry | UsageEntry

const DELETED_MEAL = '(삭제된 식사)'

// 교인은 같은 가족만 볼 수 있어, 발급한 관리자 이름은 RLS 에 가려 null 로 온다 → '관리자'
function mealOf(meal: MealRef) {
  return { mealTitle: meal?.title ?? DELETED_MEAL, servedOn: meal?.served_on ?? '' }
}

/** 발급·사용 장부를 하나의 목록으로 합쳐 최근 것부터 */
export function mergeLedger(issuances: readonly IssuanceRow[], usages: readonly UsageRow[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    ...issuances.map((i): IssuanceEntry => ({
      kind: 'issuance', id: i.id, at: i.issued_at, ...mealOf(i.meal),
      quantity: i.quantity, amount: i.quantity * i.unit_price,
      buyer: i.buyer?.name ?? '', issuer: i.issuer?.name ?? '관리자', memo: i.memo, cancelled: i.cancelled_at !== null,
    })),
    ...usages.map((u): UsageEntry => ({
      kind: 'usage', id: u.id, at: u.used_at, ...mealOf(u.meal),
      person: u.person?.name ?? '', via: u.used_via, voided: u.voided_at !== null,
    })),
  ]
  return entries.toSorted((a, b) => b.at.localeCompare(a.at))
}
