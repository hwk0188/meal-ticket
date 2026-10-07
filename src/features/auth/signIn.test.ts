import { devSignIn, redirectUrl, signInWithKakao, signOut } from './signIn'

// supabase 모듈을 통째로 가짜로 바꾸므로 실제 반환 타입 전체를 만들 필요가 없다.
// signIn 이 읽는 필드(error)와 넘기는 인자만 담은 느슨한 타입으로 둔다.
type AuthResult = { error: Error | null }
type OAuthArgs = { provider: string; options: { redirectTo: string } }
type Credentials = { email: string; password: string }

const { signInWithOAuth, signInWithPassword, signUp, authSignOut } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn<(args: OAuthArgs) => Promise<AuthResult>>(),
  signInWithPassword: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  signUp: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  authSignOut: vi.fn<() => Promise<AuthResult>>(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth, signInWithPassword, signUp, signOut: authSignOut } },
}))

describe('signIn', () => {
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
