import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Person } from '../auth/usePerson'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { TICKETS_POLL_MS, useFamilyTickets } from './useFamilyTickets'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))
vi.mock('../../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dates')>()),
  todaySeoul: () => '2026-10-12',
}))

const person = {
  id: 'p1',
  family_id: 'f1',
  name: '김철수',
  phone: '01012345678',
  auth_user_id: 'u1',
  role: 'member',
  is_minor: false,
  guardian_id: null,
  consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07',
  guardian_consented_at: null,
  deleted_at: null,
  created_at: '2026-10-07T00:00:00Z',
  updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

const todayMeal = { id: 'm1', title: '주일 점심', served_on: '2026-10-12', note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' }
const nextMeal = { ...todayMeal, id: 'm2', served_on: '2026-10-19' }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useFamilyTickets', () => {
  it('잔량·오늘 식사·가족·식사·사용을 읽어 묶는다', async () => {
    const queries: Record<string, FakeQuery<unknown>[]> = { ticket_balances: [], meals: [], people: [], usages: [] }
    from.mockImplementation((table: string) => {
      const q =
        table === 'ticket_balances'
          ? ok([
              { family_id: 'f1', meal_id: 'm1', issued: 2, used: 1, remaining: 1, amount: 10000 },
              { family_id: 'f1', meal_id: 'm2', issued: 1, used: 0, remaining: 1, amount: 5000 },
            ])
          : table === 'meals'
            ? ok((queries.meals?.length ?? 0) === 0 ? [todayMeal] : [todayMeal, nextMeal]) // 1st: eq served_on → 오늘만, 2nd: in id → 전부
            : table === 'people'
              ? ok([{ id: 'p1', name: '김철수' }])
              : ok([{ id: 'u1', meal_id: 'm1', used_at: '2026-10-12T03:31:00Z', person_id: 'p1', used_via: 'self' }])
      queries[table]!.push(q)
      return q
    })

    const { result } = renderHook(() => useFamilyTickets(person), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))

    const data = result.current.data!
    expect(data.today.map((g) => g.meal.id)).toEqual(['m1'])
    expect(data.today[0]).toMatchObject({ issued: 2, used: 1, remaining: 1 })
    expect(data.upcoming.map((g) => g.meal.id)).toEqual(['m2'])
    expect(data.members).toEqual([{ id: 'p1', name: '김철수' }])
    expect(data.usages).toHaveLength(1)

    // 관리자도 이 훅을 쓰므로(관리자는 뷰에서 모든 가족을 본다) 자기 가족으로 좁혀야 한다
    expect(queries.ticket_balances?.[0]?.has('eq', 'family_id', 'f1')).toBe(true)
    expect(queries.people?.[0]?.has('eq', 'family_id', 'f1')).toBe(true)
    expect(queries.usages?.[0]?.has('in', 'meal_id', ['m1'])).toBe(true)
    expect(queries.usages?.[0]?.has('is', 'voided_at', null)).toBe(true)
    expect(queries.meals?.[0]?.has('eq', 'served_on', '2026-10-12')).toBe(true)
    expect(queries.meals?.[1]?.has('in', 'id', ['m1', 'm2'])).toBe(true)
  })

  it('잔량도 오늘 식사도 없으면 빈 결과 (추가 조회 없음)', async () => {
    from.mockImplementation((table: string) => (table === 'ticket_balances' || table === 'meals' || table === 'people' || table === 'usages' ? ok([]) : ok(null)))
    const { result } = renderHook(() => useFamilyTickets(person), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual({ today: [], upcoming: [], past: [], usages: [], members: [] })
    // balances, today meals, people 세 번만 (ids 가 비어 meals/usages 재조회가 없다)
    expect(from).toHaveBeenCalledTimes(3)
  })

  it('5초 폴링 상수 (useQuery 의 refetchInterval 에 그대로 쓴다)', () => {
    expect(TICKETS_POLL_MS).toBe(5_000)
  })
})
