import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PAIR_POLL_MS, pairingCodeQueryKey, usePairingCode } from './usePairingCode'

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
})
