import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ok } from '../../test/fakeSupabase'
import { DUPLICATE_WINDOW_MS, findRecentDuplicate, useIssueTickets, useLatestUnitPrice } from './useIssue'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useLatestUnitPrice', () => {
  it('누구에게든 가장 최근 발급의 단가. 발급이 없으면 null', async () => {
    const q = ok({ unit_price: 5000 })
    from.mockReturnValue(q)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useLatestUnitPrice(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(5000))
    expect(q.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(q.has('limit', 1)).toBe(true)
    expect(q.has('maybeSingle')).toBe(true)
  })
})

describe('findRecentDuplicate', () => {
  it('60초 안에 같은 사람·식사·장수 발급(취소 제외)이 있으면 true', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-08T01:00:00Z'))
      const q = ok([{ id: 'i1' }])
      from.mockReturnValue(q)
      expect(DUPLICATE_WINDOW_MS).toBe(60_000)
      await expect(findRecentDuplicate({ personId: 'p1', mealId: 'm1', quantity: 4 })).resolves.toBe(true)
      expect(q.has('eq', 'person_id', 'p1')).toBe(true)
      expect(q.has('eq', 'meal_id', 'm1')).toBe(true)
      expect(q.has('eq', 'quantity', 4)).toBe(true)
      expect(q.has('is', 'cancelled_at', null)).toBe(true)
      expect(q.has('gte', 'issued_at', '2026-10-08T00:59:00.000Z')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it('없으면 false', async () => {
    from.mockReturnValue(ok([]))
    await expect(findRecentDuplicate({ personId: 'p1', mealId: 'm1', quantity: 4 })).resolves.toBe(false)
  })
})

describe('useIssueTickets', () => {
  it('issue_tickets 를 부르고 잔량·단가·식권·내역 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: 'i1' }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useIssueTickets(), { wrapper })
    await act(() => result.current.mutateAsync({ personId: 'p1', mealId: 'm1', quantity: 4, unitPrice: 5000, memo: null }))
    expect(rpc).toHaveBeenCalledWith('issue_tickets', { p_person_id: 'p1', p_meal_id: 'm1', p_quantity: 4, p_unit_price: 5000, p_memo: undefined })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-balances'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['latest-unit-price'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger'] })
  })
})
