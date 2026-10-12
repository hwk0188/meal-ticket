import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { personLedgerQueryKey, usePersonLedger } from './usePersonLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const PID = '00000000-0000-4000-8000-000000000001'
const issuance = {
  id: 'i1', issued_at: '2026-10-09T05:00:00Z', quantity: 2, unit_price: 5000, memo: '입금 확인',
  cancelled_at: null, cancel_reason: null, meal: { title: '주일 점심', served_on: '2026-10-11' },
  buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usage = {
  id: 'u1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal: { title: '주일 점심', served_on: '2026-10-11' }, person: { name: '김철수' },
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePersonLedger', () => {
  it('그 사람의 발급·사용을 최근 것부터 합쳐 돌려준다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok(table === 'issuances' ? [issuance] : [usage])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonLedger(PID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    expect(queries.issuances?.has('eq', 'person_id', PID)).toBe(true)
    expect(queries.usages?.has('eq', 'person_id', PID)).toBe(true)
    expect(queries.issuances?.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(client.getQueryData(personLedgerQueryKey(PID))).toBeDefined()
  })

  it('uuid 가 아니면 조회하지 않고 빈 목록', async () => {
    from.mockImplementation(() => ok([]))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonLedger('zzz'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})
