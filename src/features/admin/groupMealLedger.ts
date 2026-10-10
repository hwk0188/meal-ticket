import type { Balance } from '../tickets/groupTickets'

type NameRef = { name: string } | null

/** issuances 에 구매자·발급자 이름을 임베딩한 행 (select 문자열은 useMealDetail 참고) */
export type MealIssuanceRow = {
  id: string
  person_id: string
  family_id: string
  quantity: number
  unit_price: number
  memo: string | null
  issued_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  buyer: NameRef
  issuer: NameRef
}
export type MealUsageRow = {
  id: string
  person_id: string
  family_id: string
  used_at: string
  used_via: string // DB 는 check 제약뿐인 text
  voided_at: string | null
  person: NameRef
}

export type MealIssuance = {
  id: string; personId: string; buyer: string; quantity: number; unitPrice: number; amount: number
  memo: string | null; issuedAt: string; issuer: string; cancelled: boolean; cancelReason: string | null
}
export type MealUsage = { id: string; personId: string; person: string; via: 'self' | 'admin'; usedAt: string; voided: boolean }
export type FamilyRow = {
  familyId: string
  /** 구매자 이름들(활성 발급 먼저, 중복 제거) — "김철수 · 이영희". 발급이 없으면 사용자 이름. */
  label: string
  issued: number
  used: number
  remaining: number
  amount: number
  /** 최근 발급부터 */
  issuances: MealIssuance[]
  /** 최근 사용부터 */
  usages: MealUsage[]
  /** "1장 대신 사용" 의 누구 몫 — 가장 최근 활성 발급의 구매자. 활성 발급이 없으면 null (버튼 비활성) */
  buyerId: string | null
}
export type MealTotals = { issued: number; used: number; remaining: number; amount: number }
export type MealLedger = { totals: MealTotals; families: FamilyRow[] }

const NO_NAME = '(이름 없음)'
const byTimeDesc = (a: string, b: string) => Date.parse(b) - Date.parse(a)

/** 식사 하나의 발급·사용·잔량 행을 가족별 블록과 합계로 묶는다. 이름이 가려진 행(RLS·탈퇴)은 빈 이름으로 둔다. */
export function groupMealLedger(issuances: readonly MealIssuanceRow[], usages: readonly MealUsageRow[], balances: readonly Balance[]): MealLedger {
  const byFamily = new Map<string, FamilyRow>()
  const rowOf = (familyId: string): FamilyRow => {
    const existing = byFamily.get(familyId)
    if (existing) return existing
    const fresh: FamilyRow = { familyId, label: NO_NAME, issued: 0, used: 0, remaining: 0, amount: 0, issuances: [], usages: [], buyerId: null }
    byFamily.set(familyId, fresh)
    return fresh
  }
  for (const i of issuances.toSorted((a, b) => byTimeDesc(a.issued_at, b.issued_at))) {
    rowOf(i.family_id).issuances.push({
      id: i.id, personId: i.person_id, buyer: i.buyer?.name ?? '', quantity: i.quantity, unitPrice: i.unit_price,
      amount: i.quantity * i.unit_price, memo: i.memo, issuedAt: i.issued_at, issuer: i.issuer?.name ?? '관리자',
      cancelled: i.cancelled_at !== null, cancelReason: i.cancel_reason,
    })
  }
  for (const u of usages.toSorted((a, b) => byTimeDesc(a.used_at, b.used_at))) {
    rowOf(u.family_id).usages.push({
      id: u.id, personId: u.person_id, person: u.person?.name ?? '', via: u.used_via === 'admin' ? 'admin' : 'self',
      usedAt: u.used_at, voided: u.voided_at !== null,
    })
  }
  for (const b of balances) {
    if (!b.family_id) continue
    const r = rowOf(b.family_id)
    r.issued = b.issued ?? 0
    r.used = b.used ?? 0
    r.remaining = b.remaining ?? 0
    r.amount = b.amount ?? 0
  }
  for (const r of byFamily.values()) {
    // r.issuances 는 최근 발급부터(내림차순) — "1장 대신 사용" 버튼은 가장 최근 활성 발급의 구매자를 쓴다.
    const activeDesc = r.issuances.filter((i) => !i.cancelled)
    r.buyerId = activeDesc[0]?.personId ?? null
    // 라벨은 오래된 발급부터 나열한다("먼저 산 사람 먼저") — 활성 발급을 모두 앞세우고, 그 다음 취소된 발급.
    const ascending = [...r.issuances].toReversed()
    const names = [...ascending.filter((i) => !i.cancelled), ...ascending.filter((i) => i.cancelled)].map((i) => i.buyer)
    const fallback = r.usages.map((u) => u.person)
    const unique = [...new Set([...names, ...(names.some(Boolean) ? [] : fallback)].filter(Boolean))]
    r.label = unique.length > 0 ? unique.join(' · ') : NO_NAME
  }
  const families = [...byFamily.values()].toSorted((a, b) => a.label.localeCompare(b.label, 'ko'))
  const totals = families.reduce<MealTotals>(
    (t, f) => ({ issued: t.issued + f.issued, used: t.used + f.used, remaining: t.remaining + f.remaining, amount: t.amount + f.amount }),
    { issued: 0, used: 0, remaining: 0, amount: 0 },
  )
  return { totals, families }
}

/** 이름 검색: 구매자·사용자 이름 어디든 검색어가 들어 있는 가족만. 빈 검색어는 전부. */
export function filterFamilies(families: readonly FamilyRow[], query: string): FamilyRow[] {
  const q = query.trim()
  if (!q) return [...families]
  return families.filter((f) => f.label.includes(q) || f.issuances.some((i) => i.buyer.includes(q)) || f.usages.some((u) => u.person.includes(q)))
}
