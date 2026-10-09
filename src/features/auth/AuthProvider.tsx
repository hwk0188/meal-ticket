import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export type AuthState = { status: 'loading' } | { status: 'ready'; session: Session | null }

const AuthContext = createContext<AuthState | null>(null)

// 콜백에만 쓰이는 파라미터. 이것만 골라 지우고 utm_source 같은 나머지는 건드리지 않는다.
const OAUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state'] as const

/**
 * OAuth 콜백으로 붙은 파라미터를 주소에서 지운다 (해시 라우트와 다른 파라미터는 유지).
 * supabase-js 는 교환에 성공했을 때만 code 를 지우므로, 실패하거나 새로고침·공유된 콜백 URL 은
 * 매번 다시 실패한다. 세션 확인이 끝나면 성공·실패와 무관하게 지운다.
 */
function stripOAuthParams() {
  const params = new URLSearchParams(window.location.search)
  if (!OAUTH_PARAMS.some((key) => params.has(key))) return
  for (const key of OAUTH_PARAMS) params.delete(key)
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    // 구독이 먼저 알려 주면(다른 탭 로그아웃 등) 뒤늦게 끝난 getSession 의 옛 세션은 버린다.
    let settledByListener = false
    let clearTimer: ReturnType<typeof setTimeout> | undefined

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // getSession 은 보통 reject 하지 않고 error 필드로 알려 준다. 조용히 넘기지 않는다.
        if (error) console.error('세션 확인 실패', error)
        if (!active || settledByListener) return
        setState({ status: 'ready', session: data.session })
        stripOAuthParams()
      })
      .catch((error: unknown) => {
        // 세션을 못 읽어도 로딩에 갇히면 사용자가 아무것도 할 수 없다.
        // 비로그인으로 보고 시작 화면까지는 내려 준다 (거기서 다시 로그인할 수 있다).
        console.error('세션 확인 실패', error)
        if (!active || settledByListener) return
        setState({ status: 'ready', session: null })
      })

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      settledByListener = true
      setState({ status: 'ready', session })
      stripOAuthParams()
      // 어떤 경로로 로그아웃되든(버튼·탈퇴·코드 화면 "처음으로"·다른 탭·세션 만료) 캐시를 비운다 — 공용 폰에 남은
      // 가족 정보가 다음 사람에게 보이지 않게. 특히 페어링 코드 쿼리 키(['pairing-code', kind], Task 9)는 사용자별로
      // 나뉘지 않으므로, 비우지 않으면 #/pair 에서 새로 시작한 익명 계정이 이전 계정의 코드를 캐시에서 그대로
      // 읽어버릴 수 있다 — 이게 이 clear 가 없으면 안 되는 가장 강한 이유다. 콜백 안에서 supabase 를 다시 부르면
      // auth lock 에 재진입하므로 한 틱 미룬다 (설계 §15). clear 자체는 supabase 를 부르지 않지만, 캐시가 비면
      // 화면의 쿼리가 곧바로 다시 돌 수 있다.
      if (event === 'SIGNED_OUT') clearTimer = setTimeout(() => queryClient.clear(), 0)
    })

    return () => {
      active = false
      if (clearTimer) clearTimeout(clearTimer)
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

// Provider 와 그 훅을 한 파일에 두는 건 React 공식 권장 패턴이다.
// 대신 이 파일을 고치면 HMR 이 전체 새로고침으로 떨어진다 (그 정도는 감수한다).
// eslint-disable-next-line react/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있습니다')
  return ctx
}
