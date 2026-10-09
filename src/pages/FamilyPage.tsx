import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Spinner } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import { useCurrentPerson, usePerson } from '../features/auth/usePerson'
import { AddChildForm } from '../features/family/AddChildForm'
import { JoinFamilyPanel } from '../features/family/JoinFamilyPanel'
import { MemberList } from '../features/family/MemberList'
import { ProfileSection } from '../features/family/ProfileSection'
import { useLeaveFamily, useRemoveChild } from '../features/family/useFamilyActions'
import { useFamilyMembers } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS, pairingCodeQueryKey } from '../features/pairing/usePairingCode'
import { toUserMessage } from '../lib/errors'

type Panel = 'none' | 'child' | 'join'

/** `#/family` — 어른만 (RequireAdult). 구성원 목록 + 자녀 추가 + 가족 연결 + 내 정보. */
export function FamilyPage() {
  const me = useCurrentPerson()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const members = useFamilyMembers(me.family_id)
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState<string | null>(null)
  // 패널을 연 순간의 가족. 내 코드를 보여 주는 동안 상대가 나를 합치면 me.family_id 가 바뀐다 (폴링) → 렌더에서 알아챈다.
  const [familyAtOpen, setFamilyAtOpen] = useState<string | null>(null)
  const joined = panel === 'join' && familyAtOpen !== null && familyAtOpen !== me.family_id
  const leave = useLeaveFamily()
  const remove = useRemoveChild()
  // 내 코드를 보여 주는 동안(가족 연결 패널)은 배우자가 나를 자기 가족으로 합칠 수 있다 → 내 사람 행(family_id)을 폴링한다
  usePerson(userId, { refetchInterval: panel === 'join' && !joined ? PAIR_POLL_MS : false })
  const actionError = leave.isError ? toUserMessage(leave.error) : remove.isError ? toUserMessage(remove.error) : null
  const myChildren = (members.data ?? []).filter((m) => m.is_minor && m.guardian_id === me.id)

  // 한쪽 동작(가족 나가기·자녀 삭제)의 오류가 다른 동작의 성공 뒤에도 화면에 남지 않도록 둘 다 지운다.
  function resetActions() {
    leave.reset()
    remove.reset()
  }
  function done(message: string) {
    resetActions()
    setNotice(message)
    setPanel('none')
  }
  function openPanel(next: Panel) {
    setNotice(null)
    resetActions()
    setFamilyAtOpen(next === 'join' ? me.family_id : null)
    setPanel(next)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">가족</h1>
        {members.data && <p className="text-xs text-gray-500">우리 가족 · {members.data.length}명</p>}
      </header>
      {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}
      {joined && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
          가족이 연결되었어요
          <button
            type="button"
            onClick={() => {
              setPanel('none')
              // 내가 보여 주고 있던 어른 코드는 상대가 이미 써서 죽었다 — 그대로 두면 'static' staleTime 탓에
              // gcTime(10분) 동안 리페치 없이 캐시에 남아, 다음에 코드를 다시 보여 줄 때 죽은 코드의
              // 카운트다운을 보여 주게 된다. 지워 두면 다음에 열 때 새 코드를 받는다.
              queryClient.removeQueries({ queryKey: pairingCodeQueryKey('adult') })
            }}
            className="ml-2 underline"
          >
            닫기
          </button>
        </p>
      )}

      {/* status 가 아니라 data 로 분기한다 (공통 규약) */}
      {members.data ? (
        <>
          {members.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요</p>}
          <MemberList
            members={members.data}
            me={me}
            pending={leave.isPending || remove.isPending}
            onLeave={() => {
              // leave_family 도 내 family_id 를 바꾼다 — 패널을 미리 닫고 기준을 지워 두지 않으면,
              // invalidateFamily 의 내 사람 행 재조회(뮤테이션 자체의 onSuccess 보다 먼저 온다)가
              // "상대가 나를 합쳤다" 는 합류 알림으로 잘못 비친다.
              setPanel('none')
              setFamilyAtOpen(null)
              resetActions()
              leave.mutate(undefined, { onSuccess: () => done('새 가족이 되었어요') })
            }}
            onRemoveChild={(c) => {
              resetActions()
              remove.mutate(c.id, { onSuccess: () => done(`${c.name} 님을 삭제했어요`) })
            }}
          />
          {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
          {panel === 'none' && (
            <div className="flex flex-col gap-2">
              <Button variant="ghost" onClick={() => openPanel('child')}>+ 자녀 추가</Button>
              <Button variant="ghost" onClick={() => openPanel('join')}>+ 가족 연결 (배우자 등)</Button>
            </div>
          )}
          {panel === 'child' && <AddChildForm existingChildren={myChildren} onDone={done} onCancel={() => setPanel('none')} />}
          {panel === 'join' && !joined && <JoinFamilyPanel onDone={done} onCancel={() => setPanel('none')} />}
        </>
      ) : members.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          가족을 불러오지 못했어요
          <button type="button" onClick={() => void members.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
      <ProfileSection me={me} />
    </main>
  )
}
