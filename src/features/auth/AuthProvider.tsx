import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type AuthState = { status: 'loading' } | { status: 'ready'; session: Session | null }

const AuthContext = createContext<AuthState | null>(null)

/**
 * OAuth 콜백으로 붙은 ?code= / ?error= 를 주소에서 지운다 (해시 라우트는 유지).
 * supabase-js 는 교환에 성공했을 때만 code 를 지우므로, 실패하거나 새로고침·공유된 콜백 URL 은
 * 매번 다시 실패한다. 세션 확인이 끝나면 성공·실패와 무관하게 지운다.
 */
function stripOAuthParams() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('code') && !params.has('error')) return
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    // 구독이 먼저 알려 주면(다른 탭 로그아웃 등) 뒤늦게 끝난 getSession 의 옛 세션은 버린다.
    let settledByListener = false

    supabase.auth
      .getSession()
      .then(({ data }) => {
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

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      settledByListener = true
      setState({ status: 'ready', session })
      stripOAuthParams()
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

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
