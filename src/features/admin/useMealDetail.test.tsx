import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { MEAL_DETAIL_POLL_MS, mealDetailQueryKey, useMealDetail } from './useMealDetail'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '' }
const issuanceRow = {
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null, issued_at: '2026-10-09T05:00:00Z',
  cancelled_at: null, cancel_reason: null, buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usageRow = { id: 'u1', person_id: 'p1', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null, person: { name: '김철수' } }
const balanceRow = { family_id: 'f1', meal_id: 'm1', issued: 2, used: 1, remaining: 1, amount: 10000 }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useMealDetail', () => {
  it('식사·발급·사용·잔량을 식사 id 로 읽어 가족별 현황으로 묶는다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => {
      const data = table === 'meals' ? meal : table === 'issuances' ? [issuanceRow] : table === 'usages' ? [usageRow] : [balanceRow]
      return (queries[table] = ok(data))
    })
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMealDetail('m1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.meal).toEqual(meal)
    expect(result.current.data?.ledger.totals).toEqual({ issued: 2, used: 1, remaining: 1, amount: 10000 })
    expect(result.current.data?.ledger.families[0]).toMatchObject({ label: '김철수', issued: 2, used: 1 })
    expect(queries.meals?.has('eq', 'id', 'm1')).toBe(true)
    expect(queries.meals?.has('maybeSingle')).toBe(true)
    expect(queries.issuances?.has('eq', 'meal_id', 'm1')).toBe(true)
    expect(queries.usages?.has('eq', 'meal_id', 'm1')).toBe(true)
    expect(queries.ticket_balances?.has('eq', 'meal_id', 'm1')).toBe(true)
    // 캐시 키에 식사 id 가 들어간다 (다른 식사와 섞이지 않는다)
    expect(client.getQueryData(mealDetailQueryKey('m1'))).toBeDefined()
  })

  it('식사가 없으면 null (오류가 아니다)', async () => {
    from.mockImplementation((table: string) => ok(table === 'meals' ? null : []))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMealDetail('gone'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
  })

  it('5초마다 다시 읽는다 (설계 §8.3)', () => {
    expect(MEAL_DETAIL_POLL_MS).toBe(5_000)
  })
})
