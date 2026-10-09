import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router'
import { PersonShell } from '../../components/PersonShell'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { useCurrentPerson, usePerson } from './usePerson'

const CONNECTION_ERROR = '연결에 문제가 있어요. 새로고침해 주세요'

/** 로그인은 했지만 사람 행이 없는 계정이 갈 곳. 익명(아이) 계정은 가입이 아니라 연결 코드 화면이다 (claim_person 이 익명을 거부한다). */
function unregisteredPath(session: Session): string {
  return session.user.is_anonymous ? '/pair' : '/onboarding'
}

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입(또는 연결 코드), 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  // data 가 있으면(성공한 null 포함) 그대로 간다 — 폴링 한 번 실패로 화면을 갈아엎지 않는다 (공통 규약: data 로 분기)
  if (person.data !== undefined) {
    if (!person.data) return <Navigate to={unregisteredPath(auth.session)} replace />
    return (
      <PersonShell person={person.data}>
        <HomePage person={person.data} />
      </PersonShell>
    )
  }
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  return <Spinner />
}

type RequireSessionProps = {
  children: ReactNode
  /** 연결 코드 화면만 true. 그 외(가입 화면)에서 익명 계정은 /pair 로 보낸다. */
  allowAnonymous?: boolean
}

/** 로그인은 했지만 아직 가입 전인 사람만 통과 (가입·연결 코드 화면용) */
export function RequireSession({ children, allowAnonymous = false }: RequireSessionProps) {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  // data 가 있으면(성공한 null 포함) 그대로 간다 — 폴링 한 번 실패로 화면을 갈아엎지 않는다 (공통 규약: data 로 분기)
  if (person.data !== undefined) {
    if (person.data) return <Navigate to="/" replace />
    if (!allowAnonymous && auth.session.user.is_anonymous) return <Navigate to="/pair" replace />
    return <>{children}</>
  }
  // 가입 여부를 아직 모른다 (한 번도 성공한 적이 없다). 조회가 실패한 채로 가입을 진행시키지 않는다.
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  return <Spinner />
}

/** 가입을 마친 사람만 통과하는 레이아웃 라우트. 자식 화면은 useCurrentPerson() 으로 사람을 받는다. */
export function RequirePerson() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  // data 가 있으면(성공한 null 포함) 그대로 간다 — 폴링 한 번 실패로 화면을 갈아엎지 않는다 (공통 규약: data 로 분기)
  if (person.data !== undefined) {
    if (!person.data) return <Navigate to={unregisteredPath(auth.session)} replace />
    return (
      <PersonShell person={person.data}>
        <Outlet context={person.data} />
      </PersonShell>
    )
  }
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  return <Spinner />
}

/** 관리자만. RequirePerson 아래에서 쓴다. 교인이 주소를 직접 치면 홈으로 보낸다 (데이터는 RLS 가 따로 막는다). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const person = useCurrentPerson()
  if (person.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

/** 어른만 (가족 탭). 자녀 계정이 주소를 직접 치면 홈으로 보낸다 (함수들도 not_adult 로 막는다). */
export function RequireAdult({ children }: { children: ReactNode }) {
  const person = useCurrentPerson()
  if (person.is_minor) return <Navigate to="/" replace />
  return <>{children}</>
}
