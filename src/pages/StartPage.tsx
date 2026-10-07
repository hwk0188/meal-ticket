import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, TextField } from '../components/ui'
import { church } from '../config/church'
import { devSignIn, signInWithKakao } from '../features/auth/signIn'
import { env } from '../lib/env'
import { toUserMessage } from '../lib/errors'

/** 어느 버튼이 일하는 중인지. 카카오만 이동 안내를 띄우고, 성공해도 잠긴 채 둔다. */
type Pending = 'kakao' | 'dev'

export function StartPage() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const busy = pending !== null

  async function run(kind: Pending, action: () => Promise<void>, { unlockOnSuccess = true } = {}) {
    setPending(kind)
    setError(null)
    try {
      await action()
      // 카카오는 성공 시 window.location.assign 으로 떠나지만, 브라우저가 실제로 페이지를 내리기까지
      // 수백 ms 가 걸린다. 그 사이 버튼을 열면 두 번째 OAuth 가 code_verifier 를 덮어써 돌아왔을 때
      // 코드 교환이 실패한다. 그래서 성공 시엔 잠근 채 둔다.
      if (unlockOnSuccess) setPending(null)
    } catch (err) {
      setError(toUserMessage(err))
      setPending(null)
    }
  }

  function onDevSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    void run('dev', () => devSignIn(email, password))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold">{church.appName}</h1>
        <p className="mt-2 text-sm text-gray-500">주일 식사를 더 간편하게</p>
      </div>

      <Button
        variant="kakao"
        disabled={busy}
        onClick={() => void run('kakao', signInWithKakao, { unlockOnSuccess: false })}
      >
        카카오로 시작하기
      </Button>

      {pending === 'kakao' && (
        <p role="status" className="text-center text-sm text-gray-600">
          카카오 로그인 화면으로 이동하고 있어요…
        </p>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}

      {/* import.meta.env.DEV 는 운영 빌드에서 리터럴 false 로 치환되어 이 폼 전체가 번들에서 사라진다. */}
      {import.meta.env.DEV && env.enableDevLogin && (
        <form onSubmit={onDevSubmit} className="mt-6">
          <fieldset className="rounded-xl border border-dashed border-gray-300 p-4">
            <legend className="px-1 text-xs font-semibold text-gray-500">개발용 로그인 (로컬 전용)</legend>
            <div className="flex flex-col gap-3">
              <TextField label="이메일" name="email" type="email" autoComplete="username" required />
              <TextField label="비밀번호" name="password" type="password" autoComplete="current-password" required minLength={6} />
              <Button variant="ghost" type="submit" disabled={busy}>
                개발용 로그인
              </Button>
            </div>
          </fieldset>
        </form>
      )}

      <Link to="/privacy" className="mt-8 text-center text-xs text-gray-600 underline">
        개인정보 처리방침
      </Link>
    </main>
  )
}
