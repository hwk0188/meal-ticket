import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, fail, ok } from '../../test/fakeSupabase'
import { allPeopleQueryKey, useAllPeople } from './useAllPeople'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z',
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useAllPeople', () => {
  it('익명화되지 않은 사람 전부를 이름 순으로 읽고 태그·가족 수를 붙인다', async () => {
    let q: FakeQuery<unknown> | undefined
    from.mockImplementation(() => (q = ok([person])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useAllPeople(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.[0]).toMatchObject({ id: 'p1', name: '김철수', familySize: 1, tags: [] })
    expect(from).toHaveBeenCalledWith('people')
    expect(q?.has('is', 'deleted_at', null)).toBe(true)
    expect(q?.has('order', 'name')).toBe(true)
    expect(client.getQueryData(allPeopleQueryKey)).toBeDefined()
  })

  it('조회가 실패하면 코드를 보존한 Error 로 알린다', async () => {
    from.mockImplementation(() => fail('jwt expired', 'PGRST301'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAllPeople(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'PGRST301' })
  })
})
