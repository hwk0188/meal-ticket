import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Person } from '../features/auth/usePerson'
import { signOut } from '../features/auth/signIn'
import { toUserMessage } from '../lib/errors'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  // 로그아웃 뒤 캐시(['person', uid])가 gcTime 동안 남지 않도록 비운다 (공용 폰 대비).
  async function onSignOut() {
    setError(null)
    try {
      await signOut()
      queryClient.clear()
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">{person.name} 님</h1>
        <span className="text-xs text-gray-600">{maskPhone(person.phone)}</span>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
        <div className="mb-2 text-3xl" aria-hidden>🍚</div>
        <p className="text-sm">오늘은 식사가 없어요</p>
      </section>

      <div className="flex-1" />

      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => void onSignOut()}
        className="self-center text-xs text-gray-600 underline"
      >
        로그아웃
      </button>
    </main>
  )
}
