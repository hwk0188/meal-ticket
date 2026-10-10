import { mergeLedger, type IssuanceRow, type UsageRow } from './mergeLedger'

const meal = { title: '주일 점심', served_on: '2026-10-12' }
const issuance: IssuanceRow = {
  id: 'i1', issued_at: '2026-10-08T01:00:00Z', quantity: 4, unit_price: 5000, memo: '입금 확인', cancelled_at: null, cancel_reason: null,
  meal, buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usage: UsageRow = { id: 'u1', used_at: '2026-10-12T03:31:00Z', used_via: 'self', voided_at: null, meal, person: { name: '김철수' } }

describe('mergeLedger', () => {
  it('발급과 사용을 합쳐 최근 순으로 늘어놓는다', () => {
    const entries = mergeLedger([issuance], [usage])
    expect(entries.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    expect(entries[1]).toMatchObject({ kind: 'issuance', amount: 20000, quantity: 4, buyer: '김철수', issuer: '권사', mealTitle: '주일 점심', servedOn: '2026-10-12', memo: '입금 확인', cancelled: false })
    expect(entries[0]).toMatchObject({ kind: 'usage', person: '김철수', via: 'self', voided: false })
  })

  it('이름이 안 보이면(RLS 로 가려진 관리자 등) 자리를 비우지 않고 기본 문구', () => {
    const entries = mergeLedger([{ ...issuance, issuer: null, buyer: null }], [{ ...usage, person: null, meal: null }])
    expect(entries[1]).toMatchObject({ issuer: '관리자', buyer: '' })
    expect(entries[0]).toMatchObject({ person: '', mealTitle: '(삭제된 식사)', servedOn: '' })
  })

  it('취소·무효 표시를 옮긴다', () => {
    const entries = mergeLedger([{ ...issuance, cancelled_at: '2026-10-09T00:00:00Z' }], [{ ...usage, voided_at: '2026-10-12T04:00:00Z' }])
    expect(entries[1]).toMatchObject({ cancelled: true })
    expect(entries[0]).toMatchObject({ voided: true })
  })

  // PostgREST 는 초 단위 정밀도만 다른 두 시각을 '…00+00:00' 과 '…00.5+00:00' 처럼 돌려줄 수 있다.
  // ICU 의 localeCompare 는 '.' 을 '+' 보다 앞세워, 실제로는 더 늦은 .5 쪽을 문자열상 "더 이름"으로 친다.
  // Date.parse 기준 실제 시각으로 비교해야 한다.
  it('초 단위 분수 정밀도가 다른 시각도 실제 시각 순으로 놓는다', () => {
    const earlier: UsageRow = { ...usage, id: 'u-earlier', used_at: '2026-10-12T03:31:00+00:00' }
    const later: UsageRow = { ...usage, id: 'u-later', used_at: '2026-10-12T03:31:00.5+00:00' }
    const entries = mergeLedger([], [earlier, later])
    expect(entries.map((e) => e.id)).toEqual(['u-later', 'u-earlier'])
  })

  it('취소 사유를 엔트리에 싣는다 (관리자 이력 화면이 쓴다)', () => {
    const [entry] = mergeLedger(
      [{
        id: 'i1', issued_at: '2026-10-09T05:00:00Z', quantity: 2, unit_price: 5000, memo: null,
        cancelled_at: '2026-10-09T06:00:00Z', cancel_reason: '입금 취소',
        meal: { title: '주일 점심', served_on: '2026-10-11' }, buyer: { name: '김철수' }, issuer: { name: '권사' },
      }],
      [],
    )
    expect(entry).toMatchObject({ kind: 'issuance', cancelled: true, cancelReason: '입금 취소' })
  })
})
