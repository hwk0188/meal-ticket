import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { StartPage } from './StartPage'
import { church } from '../config/church'

// env 는 가짜 객체를 그대로 공유해 테스트마다 플래그만 바꾼다 (모듈을 다시 읽지 않아도 된다).
const { signInWithKakao, devSignIn, signInAsChild, env } = vi.hoisted(() => ({
  signInWithKakao: vi.fn<() => Promise<void>>(),
  devSignIn: vi.fn<(email: string, password: string) => Promise<void>>(),
  signInAsChild: vi.fn<() => Promise<void>>(),
  env: { enableDevLogin: false },
}))
vi.mock('../features/auth/signIn', () => ({ signInWithKakao, devSignIn, signInAsChild }))
vi.mock('../lib/env', () => ({ env }))

function renderPage() {
  return render(<MemoryRouter><StartPage /></MemoryRouter>)
}

describe('StartPage', () => {
  beforeEach(() => {
    env.enableDevLogin = false
  })

  it('앱 이름과 카카오 버튼, 처리방침 링크를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: church.appName })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '카카오로 시작하기' })).toBeInTheDocument()
    // 해시 라우팅·하위 경로 배포에 따라 접두사가 달라지므로 경로 조각만 본다.
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute(
      'href',
      expect.stringContaining('privacy'),
    )
  })

  it('카카오 버튼을 누르면 로그인을 시작한다', async () => {
    signInWithKakao.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카카오로 시작하기' }))
    expect(signInWithKakao).toHaveBeenCalled()
  })

  it('로그인 실패 시 안내 문구를 보여준다', async () => {
    signInWithKakao.mockRejectedValue(new Error('oauth_failed'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카카오로 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
  })

  it('카카오로 이동하는 동안은 버튼을 잠그고 안내를 보여준다', async () => {
    signInWithKakao.mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })
    await userEvent.click(button)
    // 떠나는 데 수백 ms 가 걸린다. 그 사이 두 번째 OAuth 가 code_verifier 를 덮어쓰면
    // 돌아왔을 때 코드 교환이 실패한다. 그래서 성공 시엔 잠근 채 둔다.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('카카오 로그인 화면으로 이동하고 있어요'))
    expect(button).toBeDisabled()
  })

  it('로그인이 실패하면 버튼이 다시 살아난다', async () => {
    signInWithKakao.mockRejectedValue(new Error('oauth_failed'))
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // 버튼이 굳어 버리면 사용자는 더 할 수 있는 일이 없다.
    expect(button).not.toBeDisabled()
  })

  it('다시 시도하면 이전 안내 문구를 지운다', async () => {
    signInWithKakao.mockRejectedValueOnce(new Error('oauth_failed')).mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })

    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('개발 로그인 플래그가 꺼져 있으면 이메일 폼이 없다', () => {
    renderPage()
    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument()
  })

  it('개발 로그인 실패 시 안내 문구를 보여준다', async () => {
    env.enableDevLogin = true
    devSignIn.mockRejectedValue(new Error('dev_login_disabled'))
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: '개발용 로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('개발용 로그인은 사용할 수 없어요.')
  })

  it('개발 로그인 중에는 버튼을 잠그지만 카카오 안내는 띄우지 않는다', async () => {
    env.enableDevLogin = true
    let settle: () => void = () => {}
    devSignIn.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    const submit = screen.getByRole('button', { name: '개발용 로그인' })

    await userEvent.click(submit)
    expect(submit).toBeDisabled()
    // 개발 로그인은 페이지를 떠나지 않으므로 카카오 이동 안내가 떠서는 안 된다.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      settle()
    })
    expect(submit).not.toBeDisabled()
  })

  it('개발 로그인 플래그가 켜져 있으면 이메일·비밀번호로 로그인한다', async () => {
    env.enableDevLogin = true
    devSignIn.mockResolvedValue(undefined)
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: '개발용 로그인' }))
    expect(devSignIn).toHaveBeenCalledWith('dev@test.local', 'password123')
  })

  it('아이 계정 버튼은 익명 로그인을 시작하고, 성공해도 잠근 채 둔다 (누를 때마다 새 계정이 생긴다)', async () => {
    signInAsChild.mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: /아이 계정으로 시작하기/ })
    expect(button).toHaveTextContent('카카오 없이 · 보호자 연결 필요')
    await userEvent.click(button)
    expect(signInAsChild).toHaveBeenCalledOnce()
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByRole('status')).toHaveTextContent('아이 계정을 만들고 있어요')
    // 카카오 이동 안내는 뜨지 않는다
    expect(screen.queryByText(/카카오 로그인 화면으로 이동/)).not.toBeInTheDocument()
  })

  it('아이 계정 시작이 실패하면(익명 로그인이 꺼져 있음) 그 이유를 안내하고 버튼을 다시 연다', async () => {
    // supabase-js 는 AuthApiError 로 code 를 준다 — message 가 아니라 code 를 보고 문구를 고른다 (Task 5 리뷰)
    signInAsChild.mockRejectedValue(Object.assign(new Error('Anonymous sign-ins are disabled'), { code: 'anonymous_provider_disabled' }))
    renderPage()
    const button = screen.getByRole('button', { name: /아이 계정으로 시작하기/ })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('아이 계정 시작이 꺼져 있어요. 권사님께 문의해 주세요.')
    expect(button).not.toBeDisabled()
  })

  it('bfcache 복원(카카오 화면에서 뒤로)이면 잠금을 풀고 카카오 이동 안내를 치운다', async () => {
    signInWithKakao.mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())

    act(() => {
      const event = new Event('pageshow')
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })

    expect(button).not.toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
