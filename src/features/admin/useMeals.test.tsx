import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { useAddMeal, useAdminBalances, useCreateNextSundayLunch, useDeleteMeal, useMeals } from './useMeals'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-12', note: null, created_by: 'a', created_at: '' }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useMeals / useAdminBalances', () => {
  it('식사는 날짜 내림차순, 잔량은 전체(관리자)', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = table === 'meals' ? ok([meal]) : ok([])))
    const { wrapper } = makeWrapper()
    const meals = renderHook(() => useMeals(), { wrapper })
    const balances = renderHook(() => useAdminBalances(), { wrapper })
    await waitFor(() => expect(meals.result.current.status).toBe('success'))
    await waitFor(() => expect(balances.result.current.status).toBe('success'))
    expect(meals.result.current.data).toEqual([meal])
    expect(queries.meals?.has('order', 'served_on', { ascending: false })).toBe(true)
    expect(queries.ticket_balances?.has('select', '*')).toBe(true)
  })
})

describe('mutations', () => {
  it('다음 주일 점심: rpc 호출 후 식사 캐시 무효화', async () => {
    rpc.mockReturnValue(ok(meal))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCreateNextSundayLunch(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenCalledWith('create_next_sunday_lunch')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
  })

  it('직접 추가: insert 후 single, 무효화', async () => {
    const q = ok(meal)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useAddMeal(), { wrapper })
    await act(() => result.current.mutateAsync({ title: '주일 점심', served_on: '2026-10-12', note: null }))
    expect(q.has('insert', { title: '주일 점심', served_on: '2026-10-12', note: null })).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
  })

  it('삭제: id 로 delete, 식사·잔량 캐시 무효화', async () => {
    const q = ok(null)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useDeleteMeal(), { wrapper })
    await act(() => result.current.mutateAsync('m1'))
    expect(q.has('delete')).toBe(true)
    expect(q.has('eq', 'id', 'm1')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-balances'] })
  })
})
