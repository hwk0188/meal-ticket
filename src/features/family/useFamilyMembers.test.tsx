import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ok } from '../../test/fakeSupabase'
import { canLeaveFamily, familyMembersQueryKey, useFamilyMembers, type FamilyMember } from './useFamilyMembers'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

const member = (over: Partial<FamilyMember>): FamilyMember => ({
  id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1',
  consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
})

describe('useFamilyMembers', () => {
  it('내 가족의 살아 있는 구성원을 가입 순으로 읽는다', async () => {
    const rows = [member({}), member({ id: 'p2', name: '서연', is_minor: true, guardian_id: 'p1' })]
    const q = ok(rows)
    from.mockReturnValue(q)
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useFamilyMembers('f1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(rows))
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('eq', 'family_id', 'f1')).toBe(true)
    expect(q.has('is', 'deleted_at', null)).toBe(true)
    expect(q.has('order', 'created_at')).toBe(true)
    expect(familyMembersQueryKey).toEqual(['family-members'])
    expect(client.getQueryData(['family-members', 'f1'])).toEqual(rows)
  })
})

describe('canLeaveFamily', () => {
  const me = member({})
  const myChild = member({ id: 'p2', name: '서연', is_minor: true, guardian_id: 'p1' })
  it('나와 내 자녀뿐이면 나갈 뜻이 없다 (DB 도 그때는 아무것도 바꾸지 않는다)', () => {
    expect(canLeaveFamily([me], 'p1')).toBe(false)
    expect(canLeaveFamily([me, myChild], 'p1')).toBe(false)
  })
  it('다른 어른이나 남의 자녀가 있으면 나갈 수 있다', () => {
    expect(canLeaveFamily([me, member({ id: 'p3', name: '이영희' })], 'p1')).toBe(true)
    expect(canLeaveFamily([me, member({ id: 'p4', name: '민준', is_minor: true, guardian_id: 'p3' })], 'p1')).toBe(true)
  })
})
