import { devSignIn, redirectUrl, signInWithKakao, signOut } from './signIn'

// supabase 모듈을 통째로 가짜로 바꾸므로 실제 반환 타입 전체를 만들 필요가 없다.
// signIn 이 읽는 필드(error)와 넘기는 인자만 담은 느슨한 타입으로 둔다.
type AuthResult = { error: (Error & { code?: string }) | null }
type OAuthArgs = { provider: string; options: { redirectTo: string } }
type Credentials = { email: string; password: string }

// env 는 가짜 객체를 그대로 공유해 테스트마다 플래그만 바꾼다 (모듈을 다시 읽지 않아도 된다).
const { signInWithOAuth, signInWithPassword, signUp, authSignOut, env } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn<(args: OAuthArgs) => Promise<AuthResult>>(),
  signInWithPassword: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  signUp: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  authSignOut: vi.fn<() => Promise<AuthResult>>(),
  env: { enableDevLogin: true },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth, signInWithPassword, signUp, signOut: authSignOut } },
}))
vi.mock('../../lib/env', () => ({ env }))

describe('signIn', () => {
  beforeEach(() => {
    env.enableDevLogin = true
  })

  it('redirectUrl은 origin + BASE_URL', () => {
    expect(redirectUrl()).toBe(`${window.location.origin}${import.meta.env.BASE_URL}`)
  })

  it('카카오 로그인은 kakao provider와 redirectTo를 넘긴다', async () => {
    signInWithOAuth.mockResolvedValue({ error: null })
    await signInWithKakao()
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'kakao',
      options: { redirectTo: redirectUrl() },
    })
  })

  it('카카오 로그인 오류는 그대로 던진다', async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error('oauth_failed') })
    await expect(signInWithKakao()).rejects.toThrow('oauth_failed')
  })

  it('개발 로그인: 비밀번호 로그인 성공이면 끝', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await devSignIn('a@test.local', 'password123')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 로그인 실패면 가입을 시도한다', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    signUp.mockResolvedValue({ error: null })
    await devSignIn('new@test.local', 'password123')
    expect(signUp).toHaveBeenCalledWith({ email: 'new@test.local', password: 'password123' })
  })

  it('개발 로그인: 가입도 실패하면 그 오류를 던진다', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    signUp.mockResolvedValue({ error: new Error('User already registered') })
    await expect(devSignIn('x@test.local', 'wrongpass')).rejects.toThrow('User already registered')
  })

  it('개발 로그인: 플래그가 꺼져 있으면 supabase 를 건드리지 않고 거절한다', async () => {
    env.enableDevLogin = false
    // 화면 조건만으로는 번들에서 사라지지 않는다. 운영 빌드에서 플래그가 잘못 켜져도 여기서 막힌다.
    await expect(devSignIn('x@test.local', 'password123')).rejects.toThrow('dev_login_disabled')
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 자격 증명 오류가 아니면 가입을 시도하지 않고 그대로 던진다', async () => {
    // 통신 오류까지 가입으로 넘기면 원래 오류가 묻히고 뜻하지 않은 계정이 생긴다.
    signInWithPassword.mockResolvedValue({ error: new Error('Network request failed') })
    await expect(devSignIn('x@test.local', 'password123')).rejects.toThrow('Network request failed')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 영문 문구가 달라도 code 로 자격 증명 오류를 알아본다', async () => {
    const error = Object.assign(new Error('잘못된 로그인 정보'), { code: 'invalid_credentials' })
    signInWithPassword.mockResolvedValue({ error })
    signUp.mockResolvedValue({ error: null })
    await devSignIn('new@test.local', 'password123')
    expect(signUp).toHaveBeenCalledWith({ email: 'new@test.local', password: 'password123' })
  })

  it('로그아웃을 호출한다', async () => {
    authSignOut.mockResolvedValue({ error: null })
    await signOut()
    expect(authSignOut).toHaveBeenCalled()
  })

  it('로그아웃 오류는 그대로 던진다', async () => {
    authSignOut.mockResolvedValue({ error: new Error('signout_failed') })
    await expect(signOut()).rejects.toThrow('signout_failed')
  })
})
