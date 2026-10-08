import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { church } from '../../config/church'
import { ok, fail } from '../../test/fakeSupabase'
import { profileErrorMessage, useAddChild, useDeleteAccount, useJoinFamily, useLeaveFamily, useRelinkChild, useRemoveChild, useUpdateProfile } from './useFamilyActions'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }
const { from, rpc, signOut } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<RpcResult>>(),
  signOut: vi.fn<() => Promise<void>>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))
vi.mock('../auth/signIn', () => ({ signOut }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}

const child = { id: 'p2', name: '서연', family_id: 'f1' }
const FAMILY_KEYS = [['family-members'], ['tickets'], ['ledger'], ['person']]

function expectFamilyInvalidated(invalidate: ReturnType<typeof vi.spyOn>) {
  for (const queryKey of FAMILY_KEYS) expect(invalidate).toHaveBeenCalledWith({ queryKey })
}

describe('useAddChild', () => {
  it('add_family_member 를 코드·이름으로 부르고 가족 관련 캐시를 전부 무효화한다', async () => {
    rpc.mockResolvedValue({ data: child, error: null })
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useAddChild(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '서연', code: '48291357' })
    })
    expect(rpc).toHaveBeenCalledWith('add_family_member', { p_code: '48291357', p_child_name: '서연', p_consent_version: church.consentVersion })
    expectFamilyInvalidated(invalidate)
  })

  it('서버 코드는 Error 로 (문구는 화면이 toUserMessage 로)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_code' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddChild(), { wrapper })
    act(() => result.current.mutate({ name: '서연', code: '00000000' }))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toBe('invalid_code')
  })
})

describe('useRelinkChild · useJoinFamily · useLeaveFamily · useRemoveChild', () => {
  it('각각 알맞은 RPC 를 부른다', async () => {
    rpc.mockResolvedValue({ data: child, error: null })
    const { wrapper, invalidate } = makeWrapper()
    const relink = renderHook(() => useRelinkChild(), { wrapper })
    await act(async () => {
      await relink.result.current.mutateAsync({ childId: 'p2', code: '11111111' })
    })
    expect(rpc).toHaveBeenCalledWith('relink_child', { p_child_id: 'p2', p_code: '11111111' })

    const join = renderHook(() => useJoinFamily(), { wrapper })
    await act(async () => {
      await join.result.current.mutateAsync({ code: '22222222' })
    })
    expect(rpc).toHaveBeenCalledWith('add_family_member', { p_code: '22222222' })

    const leave = renderHook(() => useLeaveFamily(), { wrapper })
    await act(async () => {
      await leave.result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('leave_family')

    rpc.mockResolvedValue({ data: null, error: null })
    const remove = renderHook(() => useRemoveChild(), { wrapper })
    await act(async () => {
      await remove.result.current.mutateAsync('p2')
    })
    expect(rpc).toHaveBeenCalledWith('remove_child', { p_child_id: 'p2' })
    expectFamilyInvalidated(invalidate)
  })
})

describe('useDeleteAccount', () => {
  it('익명화 RPC 뒤 로그아웃한다 (캐시·세션 정리는 AuthProvider)', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    signOut.mockResolvedValue(undefined)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteAccount(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('delete_my_account')
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('has_children 이면 로그아웃하지 않는다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'has_children' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteAccount(), { wrapper })
    act(() => result.current.mutate())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('useUpdateProfile', () => {
  const me = { id: 'p1', auth_user_id: 'u1' }
  it('people 행을 고치고 내 사람 캐시를 바꿔 끼운 뒤 구성원 목록을 무효화한다', async () => {
    const updated = { id: 'p1', name: '김철수A', phone: '01099998888' }
    const q = ok(updated)
    from.mockReturnValue(q)
    const { client, wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUpdateProfile(me), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '김철수A', phone: '01099998888' })
    })
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('update', { name: '김철수A', phone: '01099998888' })).toBe(true)
    expect(q.has('eq', 'id', 'p1')).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(client.getQueryData(['person', 'u1'])).toEqual(updated)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['family-members'] })
  })

  it('번호 중복(23505)은 구체적인 문구', () => {
    expect(profileErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('이미 다른 분이 쓰는 번호예요. 번호를 확인하거나 권사님께 문의해 주세요.')
    expect(profileErrorMessage(new Error('x'))).toBe('잠시 후 다시 시도해 주세요.')
  })

  it('실패하면 Error', async () => {
    from.mockReturnValue(fail('permission denied', '42501'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateProfile(me), { wrapper })
    act(() => result.current.mutate({ name: '김', phone: '01011112222' }))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })
})
