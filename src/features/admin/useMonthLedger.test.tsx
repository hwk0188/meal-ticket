import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, FakeQuery, ok } from '../../test/fakeSupabase'
import { MAX_LEDGER_ROWS, monthLedgerQueryKey, useMonthLedger } from './useMonthLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const issuanceRow = {
  id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인',
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11' },
  buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null,
}
const usageRow = {
  id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11' },
  person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null,
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useMonthLedger', () => {
  it('식사일 범위로 발급·사용을 읽는다 (임베딩 필터)', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok(table === 'issuances' ? [issuanceRow] : [usageRow])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.issuances).toEqual([issuanceRow])
    expect(result.current.data?.usages).toEqual([usageRow])
    expect(result.current.data?.truncated).toBe(false)
    for (const table of ['issuances', 'usages']) {
      // 식사일로 거는 것이 핵심이다 — 발급 시각(issued_at)이 아니라 meals.served_on 이다
      expect(queries[table]?.has('gte', 'meal.served_on', '2026-10-01')).toBe(true)
      expect(queries[table]?.has('lte', 'meal.served_on', '2026-10-31')).toBe(true)
      expect(queries[table]?.has('limit', MAX_LEDGER_ROWS)).toBe(true)
    }
    expect(queries.issuances?.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(queries.issuances?.has('order', 'id')).toBe(true)
    expect(queries.usages?.has('order', 'used_at', { ascending: false })).toBe(true)
    expect(queries.usages?.has('order', 'id')).toBe(true)
    expect(client.getQueryData(monthLedgerQueryKey('2026-10'))).toBeDefined()
  })

  it('!inner 로 조인을 강제한다 — 안 그러면 식사일 필터가 행을 지우지 못한다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok([])))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const selects = Object.values(queries).flatMap((q) => q.filters.filter(([m]) => m === 'select').map(([, a]) => String(a)))
    expect(selects).toHaveLength(2)
    for (const select of selects) expect(select).toContain('meals!inner')
    // 취소·무효 행도 CSV 에 들어간다 — 걸러내지 않는다
    for (const q of Object.values(queries)) {
      expect(q.has('is', 'cancelled_at', null)).toBe(false)
      expect(q.has('is', 'voided_at', null)).toBe(false)
    }
  })

  it('천장에 닿으면 잘렸다고 알린다 (PostgREST 가 max_rows 에서 조용히 자른다)', async () => {
    const many = Array.from({ length: MAX_LEDGER_ROWS }, (_, i) => ({ ...issuanceRow, id: `i${i}` }))
    from.mockImplementation((table: string) => ok(table === 'issuances' ? many : []))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.truncated).toBe(true)
  })

  it('월 문자열이 형식에 안 맞으면 조회하지 않고 빈 결과 (주소창으로 들어올 수 있다)', async () => {
    from.mockImplementation(() => ok([]))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-13'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual({ issuances: [], usages: [], truncated: false })
    expect(from).not.toHaveBeenCalled()
  })

  it('조회가 실패하면 코드를 보존한 Error 로 알린다', async () => {
    from.mockImplementation(() => fail('jwt expired', 'PGRST301'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'PGRST301' })
  })
})
