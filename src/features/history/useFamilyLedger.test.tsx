import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Person } from '../auth/usePerson'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { useFamilyLedger } from './useFamilyLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useFamilyLedger', () => {
  it('발급·사용을 가족으로 좁혀 최근 순으로 읽고 합친다', async () => {
    const queries: FakeQuery<unknown>[] = []
    from.mockImplementation((table: string) => {
      const q = table === 'issuances'
        ? ok([{ id: 'i1', issued_at: '2026-10-08T01:00:00Z', quantity: 4, unit_price: 5000, memo: null, cancelled_at: null, meal: { title: '주일 점심', served_on: '2026-10-12' }, buyer: { name: '김철수' }, issuer: null }])
        : ok([{ id: 'u1', used_at: '2026-10-12T03:31:00Z', used_via: 'self', voided_at: null, meal: { title: '주일 점심', served_on: '2026-10-12' }, person: { name: '김철수' } }])
      queries.push(q)
      return q
    })
    const { result } = renderHook(() => useFamilyLedger(person), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data?.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    for (const q of queries) {
      expect(q.has('eq', 'family_id', 'f1')).toBe(true)
      expect(q.has('limit', 100)).toBe(true)
    }
    expect(queries[0]?.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(queries[1]?.has('order', 'used_at', { ascending: false })).toBe(true)
  })
})
