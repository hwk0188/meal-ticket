import { buildRows, FOLD_THRESHOLD } from './buildRows'
import type { Usage } from './groupTickets'

const usage = (i: number, person_id = 'p1', used_via: 'self' | 'admin' = 'self'): Usage => ({
  id: `u${i}`, meal_id: 'm1', family_id: 'f1', person_id, quantity: 1, used_via, recorded_by: person_id,
  request_id: `r${i}`, used_at: `2026-10-12T03:3${i}:00Z`, voided_at: null, voided_by: null,
})
const members = [{ id: 'p1', name: '김철수' }, { id: 'p2', name: '서연' }]

describe('buildRows', () => {
  it('사용된 장이 먼저, 번호는 1부터, 사용 시각과 누른 폰 이름을 붙인다', () => {
    const rows = buildRows({ issued: 4, used: 2, usages: [usage(1), usage(2, 'p2')], members })
    expect(rows.map((r) => r.state)).toEqual(['used', 'used', 'open', 'open'])
    expect(rows[0]).toMatchObject({ index: 1, label: '12:31 사용 · 김철수 폰' })
    expect(rows[1]).toMatchObject({ index: 2, label: '12:32 사용 · 서연 폰' })
    expect(rows[2]).toMatchObject({ index: 3, label: undefined })
  })

  it('사용 기록보다 사용 장수가 많으면(아직 안 읽힘) 시각 없이 "사용 완료"', () => {
    const rows = buildRows({ issued: 2, used: 1, usages: [], members })
    expect(rows[0]).toMatchObject({ state: 'used', label: undefined })
  })

  it('관리자 대신 처리는 "담당자 처리", 모르는 사람은 이름 없이', () => {
    const rows = buildRows({ issued: 2, used: 2, usages: [usage(1, 'p9', 'admin'), usage(2, 'p9')], members })
    expect(rows[0]?.label).toBe('12:31 담당자 처리')
    expect(rows[1]?.label).toBe('12:32 사용')
  })

  it('접기 기준은 3장', () => {
    expect(FOLD_THRESHOLD).toBe(3)
  })
})
