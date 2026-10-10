import { filterFamilies, groupMealLedger, type MealIssuanceRow, type MealUsageRow } from './groupMealLedger'
import type { Balance } from '../tickets/groupTickets'

const issuance = (over: Partial<MealIssuanceRow>): MealIssuanceRow => ({
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null,
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  buyer: { name: '김철수' }, issuer: { name: '권사' }, ...over,
})
const usage = (over: Partial<MealUsageRow>): MealUsageRow => ({
  id: 'u1', person_id: 'p2', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  person: { name: '서연' }, ...over,
})
const balance = (over: Partial<Balance>): Balance => ({ family_id: 'f1', meal_id: 'm1', issued: 0, used: 0, remaining: 0, amount: 0, ...over })

describe('groupMealLedger', () => {
  it('가족별로 묶고, 구매자 이름(활성 발급 먼저·중복 제거)을 라벨로, 최근 것부터 정렬한다', () => {
    const rows = groupMealLedger(
      [
        issuance({ id: 'i1', issued_at: '2026-10-09T05:00:00Z' }),
        issuance({ id: 'i2', person_id: 'p3', buyer: { name: '이영희' }, issued_at: '2026-10-10T05:00:00Z', quantity: 1 }),
        issuance({ id: 'i3', issued_at: '2026-10-08T05:00:00Z', cancelled_at: '2026-10-08T06:00:00Z', cancel_reason: '실수' }),
        issuance({ id: 'i4', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수' }, issued_at: '2026-10-09T05:00:00Z', quantity: 4 }),
      ],
      [usage({ id: 'u1' }), usage({ id: 'u2', used_at: '2026-10-11T03:40:00Z', used_via: 'admin', person: { name: '김철수' } })],
      [balance({ family_id: 'f1', issued: 3, used: 2, remaining: 1, amount: 15000 }), balance({ family_id: 'f2', issued: 4, used: 0, remaining: 4, amount: 20000 })],
    )
    expect(rows.totals).toEqual({ issued: 7, used: 2, remaining: 5, amount: 35000 })
    expect(rows.families.map((f) => f.label)).toEqual(['김철수 · 이영희', '박민수'])
    const f1 = rows.families[0]!
    expect(f1).toMatchObject({ familyId: 'f1', issued: 3, used: 2, remaining: 1, amount: 15000, buyerId: 'p3' })
    expect(f1.issuances.map((i) => i.id)).toEqual(['i2', 'i1', 'i3'])
    expect(f1.issuances[0]).toMatchObject({ buyer: '이영희', quantity: 1, amount: 5000, issuer: '권사', cancelled: false })
    expect(f1.issuances[2]).toMatchObject({ cancelled: true, cancelReason: '실수' })
    expect(f1.usages.map((u) => u.id)).toEqual(['u2', 'u1'])
    expect(f1.usages[0]).toMatchObject({ person: '김철수', via: 'admin', voided: false })
  })

  it('발급 없이 사용만 남은 가족(장부가 옮겨진 경우)은 사용자 이름을 라벨로 쓴다', () => {
    const rows = groupMealLedger([], [usage({ family_id: 'f3', person: { name: '최은지' } })], [balance({ family_id: 'f3', used: 1, remaining: -1 })])
    expect(rows.families[0]).toMatchObject({ label: '최은지', buyerId: null, used: 1, remaining: -1 })
  })

  it('이름이 가려진 행(RLS·탈퇴)은 빈 이름을 건너뛰고, 아무 이름도 없으면 "(이름 없음)"', () => {
    const rows = groupMealLedger([issuance({ buyer: null }), issuance({ id: 'i2', buyer: { name: '' } })], [], [balance({})])
    expect(rows.families[0]!.label).toBe('(이름 없음)')
  })

  it('잔량 행이 없는 가족도(발급만 있고 뷰가 아직 안 읽힘) 0 으로 채운다', () => {
    const rows = groupMealLedger([issuance({})], [], [])
    expect(rows.families[0]).toMatchObject({ issued: 0, used: 0, remaining: 0, amount: 0 })
    expect(rows.totals).toEqual({ issued: 0, used: 0, remaining: 0, amount: 0 })
  })
})

describe('filterFamilies', () => {
  const families = groupMealLedger(
    [issuance({}), issuance({ id: 'i2', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수' } })],
    [usage({ family_id: 'f2', person: { name: '박서준' } })],
    [],
  ).families
  it('빈 검색어는 전부', () => {
    expect(filterFamilies(families, '  ')).toHaveLength(2)
  })
  it('구매자 이름 일부로 찾는다', () => {
    expect(filterFamilies(families, '철수').map((f) => f.label)).toEqual(['김철수'])
  })
  it('사용한 사람(자녀) 이름으로도 찾는다', () => {
    expect(filterFamilies(families, '서준').map((f) => f.label)).toEqual(['박민수'])
  })
})
