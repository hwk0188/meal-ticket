import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { USE_TIMEOUT_MS, useUseTicket } from './useUseTicket'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args: Record<string, unknown>) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

const usage = { id: 'u1', meal_id: 'm1', family_id: 'f1', person_id: 'p1', quantity: 1, used_via: 'self', recorded_by: 'p1', request_id: 'r1', used_at: '2026-10-12T03:31:00Z', voided_at: null, voided_by: null }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useUseTicket', () => {
  const ids = ['id-1', 'id-2', 'id-3']
  beforeEach(() => {
    const randomUUID = vi.fn<() => string>(() => ids.shift() ?? 'id-x')
    vi.stubGlobal('crypto', { randomUUID })
    ids.splice(0, ids.length, 'id-1', 'id-2', 'id-3')
  })

  it('use_ticket 을 식사 id 와 새 request_id 로 부르고 식권 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok(usage))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
    expect(USE_TIMEOUT_MS).toBe(5_000)
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] }))

    // 성공했으면 다음 누름은 새 request_id
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenLastCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-2' })
  })

  it('통신 오류 뒤 재시도는 같은 request_id 를 쓴다 (서버 멱등 → 이중 차감 없음)', async () => {
    rpc.mockReturnValueOnce(fail('TypeError: Failed to fetch', '')).mockReturnValueOnce(ok(usage))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined)
    })
    // react-query 의 상태 알림은 setTimeout(0) 로 미뤄진다 (notifyManager). act() 만으로는 못 기다리므로 waitFor 로 본다.
    // (여기서 기다리지 않으면 이 알림이 다음 테스트로 새어 나가 거기서 실패를 일으킨다.)
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenNthCalledWith(1, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
  })

  it('서버가 판정한 오류(no_remaining 등) 뒤에는 새 request_id', async () => {
    rpc.mockReturnValueOnce(fail('no_remaining')).mockReturnValueOnce(ok(usage))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined)
    })
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenNthCalledWith(2, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-2' })
  })

  it('★ 응답이 없으면 5초 뒤 타임아웃으로 중단한다', async () => {
    vi.useFakeTimers()
    // 절대 응답하지 않는 가짜: abortSignal 로 받은 신호를 기록해 두고, then 은 아무것도 하지 않는다.
    const pending = {
      signal: undefined as AbortSignal | undefined,
      abortSignal(s: AbortSignal) {
        this.signal = s
        return this
      },
      then() {
        // 응답이 영원히 오지 않는 상황을 흉내 낸다.
      },
    }
    rpc.mockReturnValue(pending)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    act(() => {
      void result.current.mutateAsync().catch(() => undefined)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USE_TIMEOUT_MS)
    })

    expect(pending.signal?.aborted).toBe(true)
    expect((pending.signal?.reason as { name?: string } | undefined)?.name).toBe('TimeoutError')
    vi.useRealTimers()
  })
})
