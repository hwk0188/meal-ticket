import { supabase } from '../../lib/supabase'

/** OAuth 후 돌아올 주소. GitHub Pages면 https://<user>.github.io/<repo>/ */
export function redirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export async function signInWithKakao(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: redirectUrl() },
  })
  if (error) throw error
}

/** 로컬·테스트 전용. 로그인 실패 시 가입을 시도한다 (로컬은 이메일 확인이 꺼져 있어 바로 세션이 생긴다). */
export async function devSignIn(email: string, password: string): Promise<void> {
  const signedIn = await supabase.auth.signInWithPassword({ email, password })
  if (!signedIn.error) return
  const signedUp = await supabase.auth.signUp({ email, password })
  if (signedUp.error) throw signedUp.error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
