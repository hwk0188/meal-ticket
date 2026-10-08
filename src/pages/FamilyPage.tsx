import { useState } from 'react'
import { Button, Spinner } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import { useCurrentPerson, usePerson } from '../features/auth/usePerson'
import { AddChildForm } from '../features/family/AddChildForm'
import { MemberList } from '../features/family/MemberList'
import { useLeaveFamily, useRemoveChild } from '../features/family/useFamilyActions'
import { useFamilyMembers } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { toUserMessage } from '../lib/errors'

type Panel = 'none' | 'child' | 'join'

/** `#/family` — 어른만 (RequireAdult). 구성원 목록 + 자녀 추가 + 가족 연결 + 내 정보. */
export function FamilyPage() {
  const me = useCurrentPerson()
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const members = useFamilyMembers(me.family_id)
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState<string | null>(null)
  const leave = useLeaveFamily()
  const remove = useRemoveChild()
  // 내 코드를 보여 주는 동안(가족 연결 패널)은 배우자가 나를 자기 가족으로 합칠 수 있다 → 내 사람 행(family_id)을 폴링한다
  usePerson(userId, { refetchInterval: panel === 'join' ? PAIR_POLL_MS : false })
  const actionError = leave.isError ? toUserMessage(leave.error) : remove.isError ? toUserMessage(remove.error) : null
  const myChildren = (members.data ?? []).filter((m) => m.is_minor && m.guardian_id === me.id)

  function done(message: string) {
    setNotice(message)
    setPanel('none')
  }
  function open(next: Panel) {
    setNotice(null)
    setPanel(next)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">가족</h1>
        {members.data && <p className="text-xs text-gray-500">우리 가족 · {members.data.length}명</p>}
      </header>
      {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}

      {/* status 가 아니라 data 로 분기한다 (공통 규약) */}
      {members.data ? (
        <>
          {members.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요</p>}
          <MemberList
            members={members.data}
            me={me}
            pending={leave.isPending || remove.isPending}
            onLeave={() => leave.mutate(undefined, { onSuccess: () => done('새 가족이 되었어요') })}
            onRemoveChild={(c) => remove.mutate(c.id, { onSuccess: () => done(`${c.name} 을(를) 삭제했어요`) })}
          />
          {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
          {panel === 'none' && (
            <div className="flex flex-col gap-2">
              <Button variant="ghost" onClick={() => open('child')}>+ 자녀 추가</Button>
              <Button variant="ghost" onClick={() => open('join')}>+ 가족 연결 (배우자 등)</Button>
            </div>
          )}
          {panel === 'child' && <AddChildForm existingChildren={myChildren} onDone={done} onCancel={() => setPanel('none')} />}
          {panel === 'join' && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
              가족 연결은 다음 작업에서 붙는다
              <Button variant="ghost" className="mt-2" onClick={() => setPanel('none')}>닫기</Button>
            </section>
          )}
        </>
      ) : members.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          가족을 불러오지 못했어요
          <button type="button" onClick={() => void members.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}
