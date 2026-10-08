import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

type GetSession = () => Promise<{
  data: { session: Session | null }
  error?: { message: string } | null
}>
type OnAuthStateChange = (
  callback: (event: string, session: Session | null) => void,
) => { data: { subscription: { unsubscribe: () => void } } }

const { getSession, onAuthStateChange, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn<GetSession>(),
  onAuthStateChange: vi.fn<OnAuthStateChange>(),
  unsubscribe: vi.fn<() => void>(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

function Probe() {
  const auth = useAuth()
  if (auth.status === 'loading') return <p>loading</p>
  return <p>{auth.session ? `user:${auth.session.user.id}` : 'no-session'}</p>
}

function renderWithClient() {
  const client = new QueryClient()
  const utils = render(
    <QueryClientProvider client={client}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

beforeEach(() => {
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
})

// 주소를 만지는 테스트가 다음 테스트로 새지 않게 되돌린다.
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('AuthProvider', () => {
  it('처음엔 loading, 세션이 없으면 no-session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    renderWithClient()
    expect(screen.getByText('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
  })

  it('세션이 있으면 사용자 id를 노출한다', async () => {
    const session = { user: { id: 'u1' } } as Session
    getSession.mockResolvedValue({ data: { session } })
    renderWithClient()
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument())
  })

  it('로그인 상태가 바뀌면 화면에 반영한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    renderWithClient()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())

    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_IN', { user: { id: 'u2' } } as Session))
    expect(screen.getByText('user:u2')).toBeInTheDocument()

    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()
  })

  it('세션 확인이 오류를 함께 돌려주면 기록하고 비로그인으로 둔다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // getSession 은 보통 reject 하지 않고 { data, error } 로 알려 준다. 조용히 넘기면 안 된다.
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'storage unavailable' } })

    renderWithClient()

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(consoleError).toHaveBeenCalled()
  })

  it('세션 확인이 실패해도 멈추지 않고 비로그인으로 넘긴다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getSession.mockRejectedValue(new Error('network down'))

    renderWithClient()

    // 로딩에 갇히면 사용자는 아무것도 할 수 없다. 시작 화면까지는 내려 줘야 한다.
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(consoleError).toHaveBeenCalled()
  })

  it('구독이 먼저 알려 준 상태를 뒤늦은 세션 확인이 덮어쓰지 않는다', async () => {
    let settle: (value: { data: { session: Session | null } }) => void = () => {}
    getSession.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )

    renderWithClient()
    expect(screen.getByText('loading')).toBeInTheDocument()

    // 다른 탭에서 로그아웃하면 구독이 먼저 알려 준다.
    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()

    // 뒤늦게 도착한 옛 세션이 로그아웃을 되살리면 안 된다.
    await act(async () => {
      settle({ data: { session: { user: { id: 'u1' } } as Session } })
    })
    expect(screen.getByText('no-session')).toBeInTheDocument()
  })

  it('언마운트 시 구독을 해제한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { unmount } = renderWithClient()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('OAuth 콜백 파라미터만 지우고 나머지 파라미터와 해시는 남긴다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState(null, '', '/?code=abc&state=xyz&utm_source=kakao#/')

    renderWithClient()

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(window.location.search).toBe('?utm_source=kakao')
    expect(window.location.hash).toBe('#/')
  })

  it('실패한 콜백의 오류 파라미터도 지운다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState(null, '', '/?error=access_denied&error_description=denied#/')

    renderWithClient()

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/')
  })

  it('로그아웃 이벤트가 오면 쿼리 캐시를 비운다 (어느 경로의 로그아웃이든 — 버튼·탈퇴·다른 탭)', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } as Session } })
    const { client } = renderWithClient()
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument())
    client.setQueryData(['person', 'u1'], { id: 'p1' })

    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()
    // 콜백 안에서 바로 비우지 않고 한 틱 미룬다 (auth lock 재진입 회피) — 그래서 waitFor
    await waitFor(() => expect(client.getQueryData(['person', 'u1'])).toBeUndefined())
  })

  it('로그인 이벤트는 캐시를 비우지 않는다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { client } = renderWithClient()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    client.setQueryData(['x'], 1)
    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_IN', { user: { id: 'u2' } } as Session))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(client.getQueryData(['x'])).toBe(1)
  })
})
