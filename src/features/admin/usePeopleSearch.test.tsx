import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { registerErrorMessage, sanitizeQuery, SEARCH_MIN, usePeopleSearch, useRegisterPerson } from './usePeopleSearch'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('sanitizeQuery', () => {
  it('글자·숫자·공백만 남긴다 (PostgREST 필터 문법 문자 제거)', () => {
    expect(sanitizeQuery(' 김,철수.(1234) ')).toBe('김철수1234')
    expect(sanitizeQuery('이 영희')).toBe('이 영희')
  })
})

describe('usePeopleSearch', () => {
  it('2글자 미만이면 조회하지 않는다', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePeopleSearch('김'), { wrapper })
    expect(SEARCH_MIN).toBe(2)
    expect(result.current.fetchStatus).toBe('idle')
    expect(from).not.toHaveBeenCalled()
  })

  it('이름은 ilike, 숫자가 섞이면 번호 뒷자리도 함께 (or). 탈퇴자·자녀 제외', async () => {
    const queries: FakeQuery<unknown>[] = []
    from.mockImplementation(() => {
      const q = ok([{ id: 'p1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', family_id: 'f1', is_minor: false }])
      queries.push(q)
      return q
    })
    const { wrapper } = makeWrapper()
    const { result, rerender } = renderHook(({ query }) => usePeopleSearch(query), { wrapper, initialProps: { query: '김철' } })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(queries[0]?.has('ilike', 'name', '%김철%')).toBe(true)
    expect(queries[0]?.has('is', 'deleted_at', null)).toBe(true)
    expect(queries[0]?.has('eq', 'is_minor', false)).toBe(true)
    expect(queries[0]?.has('limit', 20)).toBe(true)

    rerender({ query: '5678' })
    await waitFor(() => expect(queries.at(-1)?.has('or', 'name.ilike.%5678%,phone.like.%5678%')).toBe(true))
  })
})

describe('useRegisterPerson', () => {
  it('이름·번호로 사람을 만들고 검색 캐시를 무효화한다', async () => {
    const q = ok({ id: 'p2', name: '이순자', phone: '01022220001', auth_user_id: null, family_id: 'f2', is_minor: false })
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useRegisterPerson(), { wrapper })
    const person = await act(() => result.current.mutateAsync({ name: '이순자', phone: '01022220001' }))
    expect(person.id).toBe('p2')
    expect(q.has('insert', { name: '이순자', phone: '01022220001' })).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['people-search'] })
  })
})

describe('registerErrorMessage', () => {
  it('번호 중복(23505)은 검색을 안내하고, 나머지는 공통 문구', () => {
    expect(registerErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('이미 등록된 번호예요. 검색해서 선택해 주세요.')
    expect(registerErrorMessage({ message: 'forbidden', code: 'P0001' })).toBe('관리자만 할 수 있어요.')
  })
})
