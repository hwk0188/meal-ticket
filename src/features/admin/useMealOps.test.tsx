import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { invalidateMealOps, mealOpsErrorMessage, useCancelIssuance, useUseTicketAsAdmin, useVoidUsage } from './useMealOps'

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
function expectExactInvalidation(invalidate: ReturnType<typeof makeWrapper>['invalidate']) {
  expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(OPS_KEYS)
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
  it('cancel_issuance 를 발급 id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'i1', cancelled_at: '2026-10-10T00:00:00Z' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('i1')
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('서버가 거부하면(코드 있음) 코드를 보존한 Error 로 던지고 현황만 다시 읽는다', async () => {
    rpc.mockReturnValue(fail('would_go_negative'))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync('i1')).rejects.toMatchObject({ message: 'would_go_negative', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    // 거부되면 화면의 잔량이 낡았을 수 있다 → 현황만 다시 읽는다
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['meal-detail', 'm1']])
  })

  it('통신 오류(코드 없음)는 현황을 다시 읽지 않는다 — 오류 토스트가 재조회를 기다리지 않게', async () => {
    rpc.mockReturnValue(fail('TimeoutError: signal timed out', ''))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync('i1')).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useVoidUsage', () => {
  it('void_usage 를 사용 id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'u1', voided_at: '2026-10-10T00:00:00Z' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useVoidUsage('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('u1')
    })
    expect(rpc).toHaveBeenCalledWith('void_usage', { p_usage_id: 'u1' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('서버가 거부하면(코드 있음) 현황만 다시 읽는다', async () => {
    rpc.mockReturnValue(fail('already_voided'))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useVoidUsage('m1'), { wrapper })
    await expect(result.current.mutateAsync('u1')).rejects.toMatchObject({ message: 'already_voided', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['meal-detail', 'm1']])
  })
})

describe('useUseTicketAsAdmin', () => {
  it('use_ticket_as_admin 을 사람·식사 id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'u9', used_via: 'admin' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })
    })
    expect(rpc).toHaveBeenCalledWith('use_ticket_as_admin', { p_person_id: 'p1', p_meal_id: 'm1', p_family_id: 'f1' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })
})

describe('mealOpsErrorMessage', () => {
  it('no_remaining 은 관리자 맥락 문구로 바꾼다', () => {
    expect(mealOpsErrorMessage(new Error('no_remaining'))).toBe('남은 식권이 없어요. 현황을 다시 불러왔어요.')
  })

  it('그 외 코드는 toUserMessage 그대로', () => {
    expect(mealOpsErrorMessage(new Error('would_go_negative'))).toBe(
      '이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요.',
    )
  })
})
