import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { invalidatePeople, personOpsErrorMessage, useLinkPerson, useMergePeople, useResetPerson, useUpdatePerson } from './usePersonOps'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

const PID = '00000000-0000-4000-8000-000000000001'
const PEOPLE_KEYS = [['all-people'], ['person-detail', PID], ['person-ledger', PID], ['admin-balances'], ['tickets'], ['ledger'], ['person']]

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}
function expectExactInvalidation(invalidate: ReturnType<typeof makeWrapper>['invalidate']) {
  expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(PEOPLE_KEYS)
}

describe('invalidatePeople', () => {
  // oxlint-disable-next-line vitest/expect-expect -- 단언은 expectExactInvalidation 안의 expect() 가 한다
  it('사람 목록·상세·이력과 식권 쪽 캐시를 무효화한다', async () => {
    const { client, invalidate } = makeWrapper()
    await invalidatePeople(client, PID)
    expectExactInvalidation(invalidate)
  })
})

describe('useUpdatePerson', () => {
  it('이름·번호를 people 에 직접 쓰고 캐시를 무효화한다', async () => {
    const row = { id: PID, name: '김철수', phone: '01099998888' }
    const q = ok(row)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUpdatePerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '김철수', phone: '01099998888' })
    })
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('update', { name: '김철수', phone: '01099998888' })).toBe(true)
    expect(q.has('eq', 'id', PID)).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('번호 중복(23505)은 코드를 보존해 던진다', async () => {
    from.mockReturnValue(fail('duplicate key value', '23505'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdatePerson(PID), { wrapper })
    await expect(result.current.mutateAsync({ name: '김철수', phone: '01099998888' })).rejects.toMatchObject({ code: '23505' })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useMergePeople', () => {
  it('merge_people 를 from·into 로 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: PID }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useMergePeople(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('p9')
    })
    expect(rpc).toHaveBeenCalledWith('merge_people', { p_from_id: 'p9', p_into_id: PID })
    expectExactInvalidation(invalidate)
  })

  it('RPC 오류는 코드를 보존한다', async () => {
    rpc.mockReturnValue(fail('both_have_accounts'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMergePeople(PID), { wrapper })
    await expect(result.current.mutateAsync('p9')).rejects.toThrow('both_have_accounts')
  })
})

describe('useResetPerson', () => {
  it('admin_reset_person 를 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok(null))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useResetPerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('admin_reset_person', { p_person_id: PID })
    expectExactInvalidation(invalidate)
  })
})

describe('useLinkPerson', () => {
  it('link_person 를 사람·계정 id 로 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: PID }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useLinkPerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('123e4567-e89b-42d3-a456-426614174000')
    })
    expect(rpc).toHaveBeenCalledWith('link_person', { p_person_id: PID, p_auth_user_id: '123e4567-e89b-42d3-a456-426614174000' })
    expectExactInvalidation(invalidate)
  })
})

describe('personOpsErrorMessage', () => {
  it('사람 관리 맥락에서만 다른 세 코드를 바꿔 준다', () => {
    expect(personOpsErrorMessage(new Error('already_registered'))).toBe('이 분은 이미 카카오 계정이 연결돼 있어요.')
    expect(personOpsErrorMessage(new Error('consent_required'))).toBe('그 분의 동의 기록이 없어요. 본인이 가입 화면에서 동의해야 연결할 수 있어요.')
    expect(personOpsErrorMessage(new Error('last_admin'))).toBe('마지막 관리자는 초기화할 수 없어요. 다른 관리자를 먼저 지정해 주세요.')
  })

  it('나머지는 공용 문구 그대로', () => {
    expect(personOpsErrorMessage(new Error('both_have_accounts'))).toBe('두 분 모두 카카오 계정이 있어요. 한쪽을 먼저 초기화해 주세요.')
    expect(personOpsErrorMessage(new Error('has_children'))).toBe('연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.')
  })
})
