import type { MonthIssuanceRow, MonthUsageRow } from './useMonthLedger'
import { byMeal, filterByName, repByFamily, summarizeMonth, toStatsRows } from './statsRows'

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11' }
const other = { id: 'm2', title: '수요 저녁', served_on: '2026-10-07' }

const issuance = (over: Partial<MonthIssuanceRow> = {}): MonthIssuanceRow => ({
  id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인',
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  meal, buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null, ...over,
})
const usage = (over: Partial<MonthUsageRow> = {}): MonthUsageRow => ({
  id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal, person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null, ...over,
})
const reps = new Map([['f1', '김철수'], ['f2', '이영희']])

describe('toStatsRows', () => {
  it('발급 한 건 → 발급 행 하나 (단가·금액·처리자·메모)', () => {
    expect(toStatsRows({ issuances: [issuance()], usages: [] }, reps)).toEqual([
      {
        kind: '발급', at: '2026-10-09T05:00:00Z', servedOn: '2026-10-11', mealId: 'm1', mealTitle: '주일 점심',
        name: '김철수', familyRep: '김철수', quantity: 2, unitPrice: 5000, amount: 10000, handler: '권사', memo: '입금 확인',
      },
    ])
  })

  it('취소된 발급 → 발급 행과 취소 행 둘 (일시·처리자가 다르고 취소 메모는 사유다)', () => {
    const rows = toStatsRows(
      { issuances: [issuance({ cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '입금 취소', canceller: { name: '권사' } })], usages: [] },
      reps,
    )
    expect(rows.map((r) => r.kind)).toEqual(['취소', '발급'])
    expect(rows[0]).toMatchObject({ kind: '취소', at: '2026-10-10T01:00:00Z', quantity: 2, amount: 10000, handler: '권사', memo: '입금 취소' })
    expect(rows[1]).toMatchObject({ kind: '발급', at: '2026-10-09T05:00:00Z', memo: '입금 확인' })
  })

  it('사용·무효 행에는 단가·금액이 없다 (장부에 없는 값을 지어내지 않는다)', () => {
    const rows = toStatsRows(
      { issuances: [], usages: [usage({ voided_at: '2026-10-11T04:00:00Z', voider: { name: '권사' } })] },
      reps,
    )
    expect(rows.map((r) => r.kind)).toEqual(['무효', '사용'])
    expect(rows[0]).toMatchObject({ kind: '무효', unitPrice: null, amount: null, handler: '권사' })
    expect(rows[1]).toMatchObject({ kind: '사용', unitPrice: null, amount: null, handler: '김철수', memo: null })
  })

  it('이름이 없는 행(가려짐·탈퇴)은 빈 문자열로 둔다', () => {
    const rows = toStatsRows({ issuances: [issuance({ buyer: null, issuer: null })], usages: [] }, reps)
    expect(rows[0]).toMatchObject({ name: '', handler: '' })
  })

  it('가족 대표를 모르는 가족은 빈 칸 (살아 있는 어른이 없는 가족)', () => {
    const rows = toStatsRows({ issuances: [issuance({ family_id: 'f9' })], usages: [] }, reps)
    expect(rows[0]?.familyRep).toBe('')
  })

  it('최신순으로 섞어 정렬한다 (문자열이 아니라 실제 시각으로 — 분수 초가 섞여도 순서가 맞다)', () => {
    const rows = toStatsRows(
      {
        issuances: [issuance({ id: 'i1', issued_at: '2026-10-09T05:00:00+00:00' })],
        usages: [
          usage({ id: 'u1', used_at: '2026-10-09T05:00:00.500+00:00' }),
          usage({ id: 'u2', used_at: '2026-10-11T03:31:00Z' }),
        ],
      },
      reps,
    )
    expect(rows.map((r) => `${r.kind}:${r.at}`)).toEqual([
      '사용:2026-10-11T03:31:00Z',
      '사용:2026-10-09T05:00:00.500+00:00',
      '발급:2026-10-09T05:00:00+00:00',
    ])
  })

  it('같은 시각이면 종류·id 로 순서를 고정한다 (조회마다 자리가 바뀌지 않게)', () => {
    const a = toStatsRows({ issuances: [issuance({ id: 'iB' }), issuance({ id: 'iA' })], usages: [] }, reps)
    const b = toStatsRows({ issuances: [issuance({ id: 'iA' }), issuance({ id: 'iB' })], usages: [] }, reps)
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name))
    expect(a).toEqual(b)
  })
})

describe('summarizeMonth', () => {
  it('발급 − 취소, 사용 − 무효, 금액도 같은 규칙 (ticket_balances 와 산술이 같다)', () => {
    const rows = toStatsRows(
      {
        issuances: [
          issuance({ id: 'i1', quantity: 2, unit_price: 5000 }),
          issuance({ id: 'i2', quantity: 3, unit_price: 5000, cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '취소', canceller: { name: '권사' } }),
        ],
        usages: [
          usage({ id: 'u1', quantity: 1 }),
          usage({ id: 'u2', quantity: 1, voided_at: '2026-10-11T04:00:00Z', voider: { name: '권사' } }),
        ],
      },
      reps,
    )
    expect(summarizeMonth(rows)).toEqual({ issued: 2, used: 1, amount: 10000 })
  })

  it('빈 달은 0', () => {
    expect(summarizeMonth([])).toEqual({ issued: 0, used: 0, amount: 0 })
  })
})

describe('byMeal', () => {
  it('식사별로 묶어 식사일 늦은 것부터 (같은 날은 이름 순)', () => {
    const rows = toStatsRows(
      {
        issuances: [issuance({ id: 'i1' }), issuance({ id: 'i2', meal: other, quantity: 1 })],
        usages: [usage({ id: 'u1' })],
      },
      reps,
    )
    expect(byMeal(rows)).toEqual([
      { mealId: 'm1', servedOn: '2026-10-11', mealTitle: '주일 점심', issued: 2, used: 1, amount: 10000 },
      { mealId: 'm2', servedOn: '2026-10-07', mealTitle: '수요 저녁', issued: 1, used: 0, amount: 5000 },
    ])
  })

  it('식사별 합계도 취소·무효를 뺀다', () => {
    const rows = toStatsRows(
      { issuances: [issuance({ cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '취소', canceller: { name: '권사' } })], usages: [] },
      reps,
    )
    expect(byMeal(rows)).toEqual([{ mealId: 'm1', servedOn: '2026-10-11', mealTitle: '주일 점심', issued: 0, used: 0, amount: 0 }])
  })
})

describe('filterByName', () => {
  const rows = toStatsRows(
    { issuances: [issuance({ id: 'i1' }), issuance({ id: 'i2', family_id: 'f2', buyer: { name: '이영희' } })], usages: [] },
    reps,
  )

  it('빈 검색어는 전부', () => {
    expect(filterByName(rows, '')).toHaveLength(2)
    expect(filterByName(rows, '   ')).toHaveLength(2)
  })

  it('이름 일부로 좁힌다 (NFD 로 들어온 자모도 맞춘다)', () => {
    expect(filterByName(rows, '영희').map((r) => r.name)).toEqual(['이영희'])
    expect(filterByName(rows, '영희'.normalize('NFD')).map((r) => r.name)).toEqual(['이영희'])
  })

  it('가족 대표로도 걸린다 (한 가족의 다른 식구 이름으로 찾을 수 있게)', () => {
    expect(filterByName(rows, '김철수').map((r) => r.name)).toEqual(['김철수'])
  })

  it('받은 배열을 건드리지 않는다', () => {
    const before = rows.map((r) => r.kind)
    filterByName(rows, '영희')
    expect(rows.map((r) => r.kind)).toEqual(before)
  })
})

describe('repByFamily', () => {
  const p = (over: Partial<{ id: string; family_id: string; name: string; is_minor: boolean }> = {}) => ({
    id: 'p1', family_id: 'f1', name: '김철수', is_minor: false, ...over,
  })

  it('가족마다 어른 중 이름 순 첫 사람', () => {
    const map = repByFamily([p({ id: 'p1', name: '김철수' }), p({ id: 'p2', name: '박영수' }), p({ id: 'p3', family_id: 'f2', name: '이영희' })])
    expect(map.get('f1')).toBe('김철수')
    expect(map.get('f2')).toBe('이영희')
  })

  it('자녀는 대표가 되지 않는다', () => {
    const map = repByFamily([p({ id: 'p1', name: '서연', is_minor: true }), p({ id: 'p2', name: '최영수' })])
    expect(map.get('f1')).toBe('최영수')
  })

  it('어른이 없는 가족은 비워 둔다 (초기화된 1인 가족)', () => {
    expect(repByFamily([p({ name: '서연', is_minor: true })].map((x) => x)).get('f1')).toBeUndefined()
  })

  it('입력 순서에 기대지 않는다 (동명이인은 id 로 고정)', () => {
    const rows = [p({ id: 'pB', name: '김철수' }), p({ id: 'pA', name: '김철수' })]
    expect(repByFamily(rows).get('f1')).toBe('김철수')
    expect(repByFamily(rows.toReversed()).get('f1')).toBe('김철수')
  })
})
