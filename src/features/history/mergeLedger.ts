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
  /**
   * 관리자가 취소할 때 적은 자유 서술. **교인 쪽 조회는 아예 읽지 않는다** — 화면에 안 그리는 것만으로는
   * 교인 브라우저가 받는 JSON 에 값이 담긴다(설계 §10). 관리자 조회(usePersonLedger)만 넘겨 준다.
   */
  cancel_reason?: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
}
export type UsageRow = {
  id: string
  used_at: string
  used_via: string // DB 는 check 제약뿐인 text — 'self' | 'admin' 리터럴이 아니다
  voided_at: string | null
  meal: MealRef
  person: NameRef
}

export type IssuanceEntry = {
  kind: 'issuance'; id: string; at: string; mealTitle: string; servedOn: string
  quantity: number; amount: number; buyer: string; issuer: string; memo: string | null
  cancelled: boolean; cancelReason: string | null
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
      buyer: i.buyer?.name ?? '', issuer: i.issuer?.name ?? '관리자', memo: i.memo,
      cancelled: i.cancelled_at !== null, cancelReason: i.cancel_reason ?? null,
    })),
    ...usages.map((u): UsageEntry => ({
      kind: 'usage', id: u.id, at: u.used_at, ...mealOf(u.meal),
      person: u.person?.name ?? '', via: u.used_via === 'admin' ? 'admin' : 'self', voided: u.voided_at !== null,
    })),
  ]
  // localeCompare 는 ICU 규칙상 '.'(분수 초) 를 '+'(시간대 부호) 보다 앞세워, '…00+00:00' 과
  // '…00.5+00:00' 처럼 분수 정밀도만 다른 두 시각을 실제 순서와 반대로 놓을 수 있다. 실제 시각(ms) 으로 비교한다.
  return entries.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
}
