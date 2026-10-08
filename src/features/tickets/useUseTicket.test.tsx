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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger'] })

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

  it('서버가 판정한 오류(no_remaining 등) 뒤에는 새 request_id, 그리고 그때도 캐시를 무효화한다', async () => {
    rpc.mockReturnValueOnce(fail('no_remaining')).mockReturnValueOnce(ok(usage))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined)
    })
    // no_remaining 은 다른 폰이 먼저 썼다는 뜻이라, 실패했어도 잔량 목록을 다시 읽어야 한다.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger'] })
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenNthCalledWith(2, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-2' })
  })

  it('겹쳐 들어온 호출은 하나의 시도를 공유한다 (같은 request_id, 같은 결과)', async () => {
    // rpc 가 당장 응답하지 않는 가짜를 만들고, 나중에 외부에서 resolve 한다.
    let settle: (value: unknown) => void = () => {}
    const controllable = new Promise((resolve) => {
      settle = resolve
    })
    const fake = {
      abortSignal() {
        return this
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        return controllable.then(resolve, reject)
      },
    }
    rpc.mockReturnValue(fake)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    await act(async () => {
      // await 하지 않고 두 번 연달아 부른다 — React 가 isPending 을 반영해 버튼을 잠그기 전의 연타를 흉내 낸다.
      p1 = result.current.mutateAsync()
      p2 = result.current.mutateAsync()
      settle({ data: usage, error: null })
      await Promise.all([p1, p2])
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
    await expect(p1).resolves.toEqual(usage)
    await expect(p2).resolves.toEqual(usage)
  })

  it('★ 응답이 없으면 5초 뒤 타임아웃으로 중단하고, 다음 시도는 같은 request_id 로 재시도한다', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    vi.useFakeTimers()
    try {
      // 절대 응답하지 않다가, signal 이 abort 되는 순간 postgrest-js 가 실제로 주는 모양의 오류로 "응답"한다.
      const pending = {
        signal: undefined as AbortSignal | undefined,
        abortSignal(s: AbortSignal) {
          this.signal = s
          return this
        },
        then(resolve: (value: unknown) => void) {
          this.signal?.addEventListener('abort', () =>
            resolve({ data: null, error: { message: 'TimeoutError: signal timed out', code: '' } }),
          )
        },
      }
      rpc.mockReturnValue(pending)

      act(() => {
        void result.current.mutateAsync().catch(() => undefined)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(USE_TIMEOUT_MS)
      })

      expect(pending.signal?.aborted).toBe(true)
      expect((pending.signal?.reason as { name?: string } | undefined)?.name).toBe('TimeoutError')

      // react-query 의 실패 알림(notifyManager 의 setTimeout(0))은 onError/onSettled(캐시 무효화 포함) 뒤에
      // 걸리는 또 다른 setTimeout(0) 라, 위 advanceTimersByTimeAsync 한 번만으로는 전부 못 흘려보낼 때가 있다.
      // runAllTimersAsync 로 더 이상 걸린 타이머가 없을 때까지 돌려 끝까지 흘려보낸다.
      await act(async () => {
        await vi.runAllTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(result.current.isError).toBe(true))

    // 타임아웃은 서버 판정이 아니었으니(서버에 닿았는지 모른다) 다음 시도는 같은 request_id 로 재시도한다.
    rpc.mockReturnValue(ok(usage))
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenLastCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
  })
})
