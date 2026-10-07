import { act, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

type GetSession = () => Promise<{ data: { session: Session | null } }>
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

beforeEach(() => {
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
})

describe('AuthProvider', () => {
  it('처음엔 loading, 세션이 없으면 no-session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
  })

  it('세션이 있으면 사용자 id를 노출한다', async () => {
    const session = { user: { id: 'u1' } } as Session
    getSession.mockResolvedValue({ data: { session } })
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument())
  })

  it('로그인 상태가 바뀌면 화면에 반영한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())

    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_IN', { user: { id: 'u2' } } as Session))
    expect(screen.getByText('user:u2')).toBeInTheDocument()

    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()
  })

  it('세션 확인이 실패해도 멈추지 않고 비로그인으로 넘긴다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getSession.mockRejectedValue(new Error('network down'))

    render(<AuthProvider><Probe /></AuthProvider>)

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

    render(<AuthProvider><Probe /></AuthProvider>)
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
    const { unmount } = render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('OAuth 콜백 파라미터(?code=)를 주소에서 지운다 (해시 유지)', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState(null, '', '/?code=abc&state=xyz#/')
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/')
    window.history.replaceState(null, '', '/')
  })
})
