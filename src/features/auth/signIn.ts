import { env } from '../../lib/env'
import { supabase } from '../../lib/supabase'

// supabase-js 는 code 를 주지만 버전·배포에 따라 비어 있을 수 있어 영문 문구도 함께 본다.
const INVALID_CREDENTIALS = /invalid login credentials/i

function isInvalidCredentials(error: { code?: string; message: string }): boolean {
  return error.code === 'invalid_credentials' || INVALID_CREDENTIALS.test(error.message)
}

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

/** 로컬·테스트 전용. 아직 없는 계정이면 가입을 시도한다 (로컬은 이메일 확인이 꺼져 있어 바로 세션이 생긴다). */
export async function devSignIn(email: string, password: string): Promise<void> {
  // 화면의 플래그 조건만으로는 이 함수가 번들에서 사라지지 않는다. 운영 빌드에서 플래그가
  // 잘못 켜지더라도 카카오 본인 확인을 건너뛰는 계정이 생기지 않게 여기서 한 번 더 막는다.
  if (!env.enableDevLogin) throw new Error('dev_login_disabled')

  const signedIn = await supabase.auth.signInWithPassword({ email, password })
  if (!signedIn.error) return
  // 통신 오류·속도 제한까지 가입으로 넘기면 원래 오류가 묻히고 뜻하지 않은 계정이 생긴다.
  if (!isInvalidCredentials(signedIn.error)) throw signedIn.error

  const signedUp = await supabase.auth.signUp({ email, password })
  if (signedUp.error) throw signedUp.error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
