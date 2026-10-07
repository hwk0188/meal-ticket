import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { personQueryKey, usePerson } from './usePerson'

const { from, select, eq, is, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  select: vi.fn<(columns: string) => unknown>(),
  eq: vi.fn<(column: string, value: string) => unknown>(),
  is: vi.fn<(column: string, value: null) => unknown>(),
  maybeSingle: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

// PostgREST 빌더는 체이닝이라 각 단계가 다음 단계를 돌려주도록 이어 둔다.
beforeEach(() => {
  from.mockReturnValue({ select })
  select.mockReturnValue({ eq })
  eq.mockReturnValue({ is })
  is.mockReturnValue({ maybeSingle })
})

// 테스트마다 새 캐시를 쓴다. 재시도는 꺼서 오류 케이스가 바로 끝나게 한다.
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('personQueryKey', () => {
  it('사용자 id 로 캐시 키를 만든다', () => {
    expect(personQueryKey('u1')).toEqual(['person', 'u1'])
    expect(personQueryKey(undefined)).toEqual(['person', undefined])
  })
})

describe('usePerson', () => {
  it('로그인 전이면 조회하지 않는다', () => {
    const { result } = renderHook(() => usePerson(undefined), { wrapper: makeWrapper() })
    expect(from).not.toHaveBeenCalled()
    expect(result.current.status).toBe('pending')
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('지워지지 않은 내 사람 행을 돌려준다', async () => {
    const person = { id: 'p1', name: '김철수' }
    maybeSingle.mockResolvedValue({ data: person, error: null })

    const { result } = renderHook(() => usePerson('u1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual(person)
    expect(from).toHaveBeenCalledWith('people')
    expect(eq).toHaveBeenCalledWith('auth_user_id', 'u1')
    expect(is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('가입 전이면 null (오류가 아니다)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    const { result } = renderHook(() => usePerson('u1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
  })

  it('조회가 실패하면 진짜 Error 로 감싸 알린다', async () => {
    const raw = { message: 'boom', code: 'PGRST500' }
    maybeSingle.mockResolvedValue({ data: null, error: raw })

    const { result } = renderHook(() => usePerson('u1'), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.status).toBe('error'))
    // PostgREST 가 주는 평범한 객체는 Error 가 아니다. 스택과 cause 를 남기려 감싼다.
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('boom')
    // toUserMessage 는 message/code 를 읽으므로 그대로 보존해야 한다.
    expect(result.current.error).toMatchObject({ code: 'PGRST500', cause: raw })
  })
})
