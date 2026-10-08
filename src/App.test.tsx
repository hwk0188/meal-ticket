import { render, screen } from '@testing-library/react'
import App from './App'
import { church } from './config/church'

// 호출 기록을 검증하지 않으므로 vi.fn 대신 평범한 스텁으로 둔다.
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

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
})
