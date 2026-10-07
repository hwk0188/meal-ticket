import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, TextField } from '../components/ui'
import { church } from '../config/church'
import { devSignIn, signInWithKakao } from '../features/auth/signIn'
import { env } from '../lib/env'
import { toUserMessage } from '../lib/errors'

export function StartPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      // 카카오는 성공 시 페이지가 떠나므로 이 줄이 실행되지 않는다. 실패했을 때만 버튼이 다시 살아난다.
      setBusy(false)
    }
  }

  function onDevSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    void run(() => devSignIn(email, password))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold">{church.appName}</h1>
        <p className="mt-2 text-sm text-gray-500">주일 식사를 더 간편하게</p>
      </div>

      <Button variant="kakao" disabled={busy} onClick={() => void run(signInWithKakao)}>
        카카오로 시작하기
      </Button>

      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}

      {env.enableDevLogin && (
        <form onSubmit={onDevSubmit} className="mt-6 flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 p-4">
          <p className="text-xs font-semibold text-gray-500">개발용 로그인 (로컬 전용)</p>
          <TextField label="이메일" name="email" type="email" autoComplete="username" required />
          <TextField label="비밀번호" name="password" type="password" autoComplete="current-password" required minLength={6} />
          <Button variant="ghost" type="submit" disabled={busy}>
            개발용 로그인
          </Button>
        </form>
      )}

      <Link to="/privacy" className="mt-8 text-center text-xs text-gray-600 underline">
        개인정보 처리방침
      </Link>
    </main>
  )
}
