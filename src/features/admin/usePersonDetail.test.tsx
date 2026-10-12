import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { personDetailQueryKey, usePersonDetail } from './usePersonDetail'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const PID = '00000000-0000-4000-8000-000000000001'
const person = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
}
const sibling = { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k1', role: 'member', deleted_at: null }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePersonDetail', () => {
  it('사람 한 명과 같은 가족 구성원을 읽는다', async () => {
    const queries: FakeQuery<unknown>[] = []
    from.mockImplementation(() => {
      const q = ok(queries.length === 0 ? person : [person, sibling])
      queries.push(q)
      return q
    })
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail(PID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.person).toEqual(person)
    expect(result.current.data?.family.map((m) => m.name)).toEqual(['김철수', '서연'])
    expect(queries[0]?.has('eq', 'id', PID)).toBe(true)
    expect(queries[0]?.has('maybeSingle')).toBe(true)
    // 익명화된 행도 읽는다 — 초기화·합치기 직후 화면이 "없는 사람" 으로 바뀌지 않게 (deleted_at 필터 없음)
    expect(queries[0]?.has('is', 'deleted_at', null)).toBe(false)
    expect(queries[1]?.has('eq', 'family_id', 'f1')).toBe(true)
    expect(client.getQueryData(personDetailQueryKey(PID))).toBeDefined()
  })

  it('없는 사람은 null (오류가 아니다)', async () => {
    from.mockImplementation(() => ok(null))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail(PID), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
  })

  it('uuid 가 아닌 주소는 조회하지 않고 null', async () => {
    from.mockImplementation(() => ok(null))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail('zzz'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})
