import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ok } from '../../test/fakeSupabase'
import { invalidateMealOps, useCancelIssuance, useUseTicketAsAdmin, useVoidUsage } from './useMealOps'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

const OPS_KEYS = [['meal-detail', 'm1'], ['admin-balances'], ['tickets'], ['ledger']]

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}
// 키 목록 전체를 정확히 — 스파이를 여러 훅이 공유하면 한 훅의 onSuccess 가 빠져도 통과한다 (공통 규약)
function expectExactInvalidation(invalidate: { mock: { calls: unknown[][] } }) {
  expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey)).toEqual(OPS_KEYS)
}

describe('invalidateMealOps', () => {
  // oxlint-disable-next-line vitest/expect-expect -- 단언은 expectExactInvalidation 안의 expect() 가 한다
  it('식사 현황·관리자 합계·식권·내역을 무효화한다', async () => {
    const { client, invalidate } = makeWrapper()
    await invalidateMealOps(client, 'm1')
    expectExactInvalidation(invalidate)
  })
})

describe('useCancelIssuance', () => {
  it('cancel_issuance 를 발급 id 로 부르고 성공 시 네 키를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: 'i1', cancelled_at: '2026-10-10T00:00:00Z' }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('i1')
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1' })
    expectExactInvalidation(invalidate)
  })

  it('RPC 오류는 코드를 보존한 Error 로 던진다', async () => {
    rpc.mockReturnValue({ then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'P0001', message: 'would_go_negative', details: '', hint: '', name: 'PostgrestError' } }).then(resolve) })
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync('i1')).rejects.toMatchObject({ message: 'would_go_negative', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    // 거부되면 화면의 잔량이 낡았을 수 있다 → 현황만 다시 읽는다
    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey)).toEqual([['meal-detail', 'm1']])
  })
})

describe('useVoidUsage', () => {
  it('void_usage 를 사용 id 로 부르고 성공 시 네 키를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: 'u1', voided_at: '2026-10-10T00:00:00Z' }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useVoidUsage('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('u1')
    })
    expect(rpc).toHaveBeenCalledWith('void_usage', { p_usage_id: 'u1' })
    expectExactInvalidation(invalidate)
  })
})

describe('useUseTicketAsAdmin', () => {
  it('use_ticket_as_admin 을 사람·식사 id 로 부르고 성공 시 네 키를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })
    })
    expect(rpc).toHaveBeenCalledWith('use_ticket_as_admin', { p_person_id: 'p1', p_meal_id: 'm1', p_family_id: 'f1' })
    expectExactInvalidation(invalidate)
  })
})
