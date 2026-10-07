import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { usePerson } from './usePerson'

const CONNECTION_ERROR = '연결에 문제가 있어요. 새로고침해 주세요'

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입, 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (!person.data) return <Navigate to="/onboarding" replace />
  return <HomePage person={person.data} />
}

/** 로그인은 했지만 아직 가입 전인 사람만 통과 (가입 화면용) */
export function RequireSession({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  if (person.status === 'pending') return <Spinner />
  // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키지 않는다.
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (person.data) return <Navigate to="/" replace />
  return <>{children}</>
}
