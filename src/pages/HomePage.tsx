import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import { signOut } from '../features/auth/signIn'
import { toUserMessage } from '../lib/errors'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      // 로그아웃 뒤 캐시(['person', uid])가 gcTime 동안 남지 않도록 비운다 (공용 폰 대비).
      queryClient.clear()
      // 성공하면 Gate 가 시작 화면으로 바꾼다. 그 사이 두 번째 로그아웃이 나가지 않게 잠근 채 둔다.
    } catch (err) {
      setError(toUserMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">{person.name} 님</h1>
        <span className="text-xs text-gray-600">{maskPhone(person.phone)}</span>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
        <div className="mb-2 text-3xl" aria-hidden>🍚</div>
        <p className="text-sm">오늘은 식사가 없어요</p>
      </section>

      <div className="flex-1" />

      <footer className="flex items-center justify-center gap-4">
        <Link to="/privacy" className="px-3 py-2 text-xs text-gray-600 underline">개인정보 처리방침</Link>
        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={busy}
          className="px-3 py-2 text-xs text-gray-600 underline"
        >
          로그아웃
        </button>
      </footer>

      {/* 안내는 버튼 아래에 둔다. 위에 끼우면 다시 누르려는 손가락이 문구 위에 떨어진다. */}
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
    </main>
  )
}
