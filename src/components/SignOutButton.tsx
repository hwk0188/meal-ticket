import { useState } from 'react'
import { signOut } from '../features/auth/signIn'
import { toUserMessage } from '../lib/errors'
import { ConfirmButton } from './ConfirmButton'

type Props = { label?: string; message?: string }

/**
 * 로그아웃. 성공하면 AuthProvider 가 세션·캐시를 비우고 Gate 가 시작 화면을 띄우므로, 그 사이 두 번째 호출이
 * 나가지 않게 잠근 채 둔다. message 가 있으면(아이 계정) 한 번 더 묻는다.
 */
export function SignOutButton({ label = '로그아웃', message }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
    } catch (err) {
      setError(toUserMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <ConfirmButton label={label} message={message} confirmLabel="네, 로그아웃" onConfirm={() => void run()} disabled={busy} align="center" />
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
    </div>
  )
}
