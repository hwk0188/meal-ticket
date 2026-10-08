import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PAIR_CODE_TTL_MS, PAIR_POLL_MS, pairingCodeQueryKey, usePairingCode } from './usePairingCode'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const row = { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }

describe('usePairingCode', () => {
  it('상수와 키', () => {
    expect(PAIR_POLL_MS).toBe(3_000)
    // 마이그레이션의 interval '10 minutes' (supabase/migrations/20261009000001_pairing_codes.sql) 와 같아야 한다.
    expect(PAIR_CODE_TTL_MS).toBe(10 * 60_000)
    expect(pairingCodeQueryKey('child')).toEqual(['pairing-code', 'child'])
  })

  it('종류를 넘겨 코드를 받는다', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(rpc).toHaveBeenCalledWith('create_pairing_code', { p_kind: 'child' })
    expect(result.current.data).toEqual(row)
  })

  it('"새 코드 받기"(refetch) 는 서버를 다시 부른다 — 자동 재조회는 없다', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const { result } = renderHook(() => usePairingCode('adult'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.refetch()
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith('create_pairing_code', { p_kind: 'adult' })
  })

  it('서버 오류는 Error 로 (문구는 toUserMessage 가 맡는다)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_registered' } })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toBe('already_registered')
  })

  it('빈 결과는 오류로 드러낸다', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toMatch(/코드를 받지 못했습니다/)
  })

  it('재조회가 실패한 뒤 다시 마운트해도 코드를 다시 발급하지 않는다 (staleTime static)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const freshRow = { code: '12345678', expires_at: '2026-10-12T04:00:00Z' }

    rpc.mockResolvedValueOnce({ data: [freshRow], error: null })
    const first = renderHook(() => usePairingCode('child'), { wrapper })
    // status 를 먼저 추적해 둬야(tracked properties) refetch 실패로 status 가 바뀔 때도 리렌더를 받는다.
    await waitFor(() => expect(first.result.current.status).toBe('success'))
    expect(first.result.current.data?.code).toBe('12345678')

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'network_error' } })
    await act(async () => {
      await first.result.current.refetch()
    })
    await waitFor(() => expect(first.result.current.isError).toBe(true))
    expect(first.result.current.data?.code).toBe('12345678')

    const callCountAfterFailedRefetch = rpc.mock.calls.length
    first.unmount()

    const second = renderHook(() => usePairingCode('child'), { wrapper })
    // 실패한 재조회 뒤라 캐시의 status 는 'error' 지만(그래도 data 는 남아 있다), 'static' 덕에 리마운트가
    // 조용히 새 코드를 또 부르지는 않는다 — 공통 규약대로 status 가 아니라 data 로 판단한다.
    await waitFor(() => expect(second.result.current.data?.code).toBeDefined())
    expect(rpc).toHaveBeenCalledTimes(callCountAfterFailedRefetch)
    expect(second.result.current.data?.code).toBe('12345678')
  })
})
