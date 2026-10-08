import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { church } from './config/church'

type FakeSession = { user: { id: string; is_anonymous?: boolean } } | null

// getSession 만 테스트마다 값을 바꿔야 해서 vi.fn 으로 둔다. 나머지는 호출 기록을 검증하지 않으므로 평범한 스텁이다.
const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<{ data: { session: FakeSession } }>>(),
}))
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    // usePerson 이 호출한다. 사람 조회가 null 로 끝나야(가입 전) 가드가 다음 화면으로 보낸다.
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }),
  },
}))

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } })
})

// HashRouter 는 마운트 시점의 해시를 읽는다. 다음 테스트로 새지 않게 되돌린다.
afterEach(() => {
  window.location.hash = ''
})

describe('App', () => {
  it('비로그인 상태에서 시작 화면을 보여준다', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: church.appName })).toBeInTheDocument()
  })

  // 오래된 링크나 오타로 들어와도 빈 화면을 보여 주지 않고 홈 주소로 정리한다.
  it('모르는 주소는 홈으로 되돌린다', async () => {
    window.location.hash = '#/nope'
    render(<App />)
    expect(await screen.findByRole('heading', { name: church.appName })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  // 개인정보 처리방침은 동의 화면과 카카오 심사에서 링크로 열리므로 로그인 없이 닿아야 한다.
  it('로그인 전에도 개인정보 처리방침을 볼 수 있다', async () => {
    window.location.hash = '#/privacy'
    render(<App />)
    expect(await screen.findByRole('heading', { name: '개인정보 처리방침' })).toBeInTheDocument()
  })

  // /pair 라우트가 없으면 가드가 /pair 로 보내도 '*' → '/' → /pair … 로 무한 리다이렉트된다.
  it('익명(아이) 계정으로 가입 전이면 /pair 로 보내고, 무한 리다이렉트 없이 화면이 뜬다', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'k1', is_anonymous: true } } } })
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/pair'))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
