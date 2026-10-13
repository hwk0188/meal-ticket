import { nameKey } from '../../lib/search'
import type { MonthIssuanceRow, MonthUsageRow } from './useMonthLedger'

export type StatsKind = '발급' | '취소' | '사용' | '무효'

/** CSV 한 줄과 화면 한 줄이 같은 모양이다 — 둘이 어긋날 수 없게 한 곳에서 만든다. */
export type StatsRow = {
  kind: StatsKind
  /** 그 동작이 일어난 시각 (발급/취소/사용/무효 각각 다르다) */
  at: string
  servedOn: string
  mealId: string
  mealTitle: string
  /** 구매자 또는 사용자. 가려진 행은 DB 가 '탈퇴한 사용자' 로 돌려준다. 참조가 없으면 빈 문자열. */
  name: string
  familyRep: string
  quantity: number
  /** 사용·무효에는 없다 — 장부에 없는 값을 지어내지 않는다. */
  unitPrice: number | null
  amount: number | null
  /** 그 동작을 기록한 사람 (발급 issued_by · 취소 cancelled_by · 사용 recorded_by · 무효 voided_by) */
  handler: string
  memo: string | null
}

export type MealStats = { mealId: string; servedOn: string; mealTitle: string; issued: number; used: number; amount: number }
export type MonthTotals = { issued: number; used: number; amount: number }

type Source = { issuances: readonly MonthIssuanceRow[]; usages: readonly MonthUsageRow[] }

const nameOf = (ref: { name: string } | null) => ref?.name ?? ''

// 같은 시각이 섞일 수 있어 종류·id 로 순서를 고정한다 (조회마다 줄이 뒤바뀌면 CSV 가 매번 달라진다).
const KIND_ORDER: Record<StatsKind, number> = { 발급: 0, 취소: 1, 사용: 2, 무효: 3 }

/**
 * 원본 장부를 통계 행으로 펼친다. 취소된 발급은 `발급`·`취소` 두 행이 되고(일시가 다르다), 무효 처리된 사용도
 * `사용`·`무효` 두 행이 된다 — 설계의 "취소·무효 행 포함" 이 이것이다.
 * 정렬은 최신순. `localeCompare` 는 ICU 규칙상 분수 초('.')를 시간대 부호('+')보다 앞세워 실제 순서를 뒤집을 수
 * 있으므로(교인 내역에서 당했다) **실제 시각(ms)** 으로 비교한다.
 */
export function toStatsRows(source: Source, repByFamily: ReadonlyMap<string, string>): StatsRow[] {
  const rows: StatsRow[] = []
  for (const i of source.issuances) {
    const common = {
      servedOn: i.meal.served_on,
      mealId: i.meal.id,
      mealTitle: i.meal.title,
      name: nameOf(i.buyer),
      familyRep: repByFamily.get(i.family_id) ?? '',
      quantity: i.quantity,
      unitPrice: i.unit_price,
      amount: i.quantity * i.unit_price,
    }
    rows.push({ ...common, kind: '발급', at: i.issued_at, handler: nameOf(i.issuer), memo: i.memo })
    if (i.cancelled_at !== null) {
      rows.push({ ...common, kind: '취소', at: i.cancelled_at, handler: nameOf(i.canceller), memo: i.cancel_reason })
    }
  }
  for (const u of source.usages) {
    const common = {
      servedOn: u.meal.served_on,
      mealId: u.meal.id,
      mealTitle: u.meal.title,
      name: nameOf(u.person),
      familyRep: repByFamily.get(u.family_id) ?? '',
      quantity: u.quantity,
      unitPrice: null,
      amount: null,
      memo: null,
    }
    rows.push({ ...common, kind: '사용', at: u.used_at, handler: nameOf(u.recorder) })
    if (u.voided_at !== null) {
      rows.push({ ...common, kind: '무효', at: u.voided_at, handler: nameOf(u.voider) })
    }
  }
  return rows.toSorted(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.mealId.localeCompare(b.mealId) ||
      a.name.localeCompare(b.name, 'ko'),
  )
}

/** 취소·무효를 뺀 그 달 합계. ticket_balances 뷰와 산술이 같다. */
export function summarizeMonth(rows: readonly StatsRow[]): MonthTotals {
  let issued = 0
  let used = 0
  let amount = 0
  for (const r of rows) {
    if (r.kind === '발급') {
      issued += r.quantity
      amount += r.amount ?? 0
    } else if (r.kind === '취소') {
      issued -= r.quantity
      amount -= r.amount ?? 0
    } else if (r.kind === '사용') {
      used += r.quantity
    } else {
      used -= r.quantity
    }
  }
  return { issued, used, amount }
}

/** 식사별 행, 식사일 늦은 것부터 (같은 날은 이름 순 — 조회마다 순서가 바뀌지 않게). */
export function byMeal(rows: readonly StatsRow[]): MealStats[] {
  const out = new Map<string, MealStats>()
  for (const r of rows) {
    const s = out.get(r.mealId) ?? { mealId: r.mealId, servedOn: r.servedOn, mealTitle: r.mealTitle, issued: 0, used: 0, amount: 0 }
    const sign = r.kind === '취소' || r.kind === '무효' ? -1 : 1
    if (r.kind === '발급' || r.kind === '취소') {
      s.issued += sign * r.quantity
      s.amount += sign * (r.amount ?? 0)
    } else {
      s.used += sign * r.quantity
    }
    out.set(r.mealId, s)
  }
  return [...out.values()].toSorted((a, b) => b.servedOn.localeCompare(a.servedOn) || a.mealTitle.localeCompare(b.mealTitle, 'ko'))
}

/** 이름(구매자·사용자) 또는 가족 대표로 좁힌다. 번호 검색은 두지 않는다 — 장부 행에 번호가 없다. */
export function filterByName(rows: readonly StatsRow[], query: string): StatsRow[] {
  const key = nameKey(query)
  if (!key) return [...rows]
  return rows.filter((r) => nameKey(r.name).includes(key) || nameKey(r.familyRep).includes(key))
}

/** 가족 대표를 뽑을 때 필요한 최소 모양 — `useAllPeople` 의 행이 그대로 들어맞는다. */
type RepCandidate = { id: string; family_id: string; name: string; is_minor: boolean }

/**
 * 가족마다 "대표" 한 사람의 이름. 스키마에 대표 열이 없어 **살아 있는 어른 중 이름 순 첫 사람**으로 정한다
 * (4b 의 가족 힌트와 같은 규칙). 동명이인은 id 로 고정해 입력 순서에 기대지 않는다.
 * 어른이 없는 가족(초기화된 1인 가족 등)은 아예 담지 않는다 — 통계 행에서는 빈 칸이 된다.
 * `useAllPeople` 이 익명화된 행을 이미 빼고 읽으므로 여기서 다시 거르지 않는다.
 */
export function repByFamily(people: readonly RepCandidate[]): Map<string, string> {
  const best = new Map<string, RepCandidate>()
  for (const p of people) {
    if (p.is_minor) continue
    const current = best.get(p.family_id)
    if (!current || p.name.localeCompare(current.name, 'ko') < 0 || (p.name === current.name && p.id < current.id)) {
      best.set(p.family_id, p)
    }
  }
  return new Map([...best].map(([familyId, p]) => [familyId, p.name]))
}
