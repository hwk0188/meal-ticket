import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import {
  invalidateMealOps,
  mealOpsErrorMessage,
  OPS_TIMEOUT_MS,
  SETTLE_TIMEOUT_MS,
  useCancelIssuance,
  useUseTicketAsAdmin,
  useVoidUsage,
} from './useMealOps'

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
      await result.current.mutateAsync({ issuanceId: 'i1', reason: '  입금 취소  ' })
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1', p_reason: '입금 취소' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('사유가 비면 p_reason 을 보내지 않는다', async () => {
    const q = ok({ id: 'i1' })
    rpc.mockReturnValue(q)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ issuanceId: 'i1', reason: '   ' })
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1' })
  })

  it('서버가 거부하면(코드 있음) 코드를 보존한 Error 로 던지고 현황만 다시 읽는다', async () => {
    rpc.mockReturnValue(fail('would_go_negative'))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync({ issuanceId: 'i1', reason: '' })).rejects.toMatchObject({ message: 'would_go_negative', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    // 거부되면 화면의 잔량이 낡았을 수 있다 → 현황만 다시 읽는다
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['meal-detail', 'm1']])
  })

  it('통신 오류(코드 없음)는 현황을 다시 읽지 않는다 — 오류 토스트가 재조회를 기다리지 않게', async () => {
    rpc.mockReturnValue(fail('TimeoutError: signal timed out', ''))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync({ issuanceId: 'i1', reason: '' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it(`성공 뒤 재조회가 ${SETTLE_TIMEOUT_MS}ms 안에 끝나지 않아도 버튼을 풀어 준다 (재조회에는 타임아웃이 없다 — 끊긴 연결 대비)`, async () => {
    rpc.mockReturnValue(ok({ id: 'i1', cancelled_at: '2026-10-10T00:00:00Z' }))
    const { wrapper, invalidate } = makeWrapper()
    // 재조회가 영영 끝나지 않는 상황(끊긴 연결)을 흉내 낸다 — useMealDetail 의 queryFn 에는 AbortSignal 이 없다.
    invalidate.mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })

    vi.useFakeTimers()
    try {
      act(() => {
        void result.current.mutateAsync({ issuanceId: 'i1', reason: '' }).catch(() => undefined)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SETTLE_TIMEOUT_MS - 1)
      })
      // 재조회가 끝나지 않았으니 아직 처리 중이어야 한다
      expect(result.current.isPending).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      // react-query 의 성공 알림(notifyManager 의 setTimeout(0))은 바로 위 타이머가 끝난 뒤에 걸리는 또 다른
      // setTimeout(0) 라, advanceTimersByTimeAsync 한 번만으로는 전부 못 흘려보낼 때가 있다 (★ 타임아웃 테스트와 같은 사정).
      await act(async () => {
        await vi.runAllTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }
    // 한도를 넘으면 재조회가 안 끝났어도 성공으로 풀어 준다 — 5초 폴링이 뒤따라 맞춘다
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.isSuccess).toBe(true)
  })

  it(`SETTLE_TIMEOUT_MS 는 ${SETTLE_TIMEOUT_MS}ms`, () => {
    expect(SETTLE_TIMEOUT_MS).toBe(3_000)
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
  it('use_ticket_as_admin 을 사람·식사 id 와 새 request_id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'u9', used_via: 'admin' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })
    })
    expect(rpc).toHaveBeenCalledWith(
      'use_ticket_as_admin',
      expect.objectContaining({ p_person_id: 'p1', p_meal_id: 'm1', p_family_id: 'f1', p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    )
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('통신 오류(코드 없음) 뒤 같은 대상 재시도는 같은 request_id 를 쓴다 (서버 멱등 → 이중 차감 없음)', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).toBe(secondArgs?.p_request_id)
    expect(firstArgs?.p_request_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('서버가 판정한 오류(코드 있음) 뒤에는 같은 대상이라도 새 request_id', async () => {
    rpc.mockReturnValueOnce(fail('no_remaining')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('no_remaining')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('성공 뒤 같은 대상을 다시 쓰면 새 request_id', async () => {
    rpc.mockReturnValue(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('통신 오류 뒤 다른 대상(가족이 다름)을 쓰면 새 request_id (키가 다르다)', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f2' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('대상 A 가 타임아웃으로 재시도 id 를 들고 있는 동안 대상 B 를 처리해도 A 의 슬롯을 덮어쓰지 않는다', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')) // A 1차: 통신 오류
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'pA', familyId: 'fA' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    const idA = (rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined)?.p_request_id

    rpc.mockReturnValueOnce(ok({ id: 'u-b', used_via: 'admin' })) // B: 다른 대상, 성공
    await act(() => result.current.mutateAsync({ personId: 'pB', familyId: 'fB' }))

    rpc.mockReturnValueOnce(ok({ id: 'u-a', used_via: 'admin' })) // A 재시도: 1차와 같은 id 를 보내야 한다
    await act(() => result.current.mutateAsync({ personId: 'pA', familyId: 'fA' }))

    const idARetry = (rpc.mock.calls[2]?.[1] as { p_request_id?: string } | undefined)?.p_request_id
    expect(idARetry).toBe(idA)
    expect(idA).toMatch(/^[0-9a-f-]{36}$/)
  })

  it(`OPS_TIMEOUT_MS(${OPS_TIMEOUT_MS}ms) 안에 응답이 없으면 요청을 끊는다`, async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    vi.useFakeTimers()
    try {
      const pending = {
        signal: undefined as AbortSignal | undefined,
        abortSignal(s: AbortSignal) {
          this.signal = s
          return this
        },
        then(resolve: (value: unknown) => void) {
          this.signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'TimeoutError: signal timed out', code: '' } }))
        },
      }
      rpc.mockReturnValue(pending)

      act(() => {
        void result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }).catch(() => undefined)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPS_TIMEOUT_MS)
      })

      expect(pending.signal?.aborted).toBe(true)
      expect((pending.signal?.reason as { name?: string } | undefined)?.name).toBe('TimeoutError')

      await act(async () => {
        await vi.runAllTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(result.current.isError).toBe(true))
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
