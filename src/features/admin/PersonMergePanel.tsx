import { useState } from 'react'
import { Button, TextField } from '../../components/ui'
import { formatPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { filterPeople, type DecoratedPerson } from './peopleFilter'
import { useAllPeople } from './useAllPeople'
import { personOpsErrorMessage, useMergePeople } from './usePersonOps'

type Props = { person: Person; onDone: (message: string) => void }

/** 후보를 두 글자부터 보여 준다 — 열자마자 전 교인 명단이 쏟아지면 잘못 고를 위험만 커진다. */
const MIN_QUERY = 2
const label = (p: DecoratedPerson | Person) => `${p.name}(${p.phone ? formatPhone(p.phone) : '번호 없음'})`

/**
 * 중복 사람 합치기. 보고 있는 사람이 **남는 쪽**(into), 고른 사람이 **익명 처리되는 쪽**(from) 이다.
 * 방향을 틀리면 되돌릴 수 없으므로 확인 문구에 두 사람의 이름·번호를 모두 적는다.
 */
export function PersonMergePanel({ person, onDone }: Props) {
  const people = useAllPeople()
  const merge = useMergePeople(person.id)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DecoratedPerson | null>(null)

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { merge.reset(); setOpen(true) }}>중복 사람 합치기</Button>
    )
  }

  // 본인과 자녀는 후보가 아니다 (자녀는 가족 탭의 다시 연결·삭제로 관리한다). 익명화된 행은 useAllPeople 이 이미 뺀다.
  const candidates = people.data
    ? filterPeople(people.data, query, 'all').filter((p) => p.id !== person.id && !p.is_minor)
    : []
  const bothLinked = (p: DecoratedPerson) => person.auth_user_id !== null && p.auth_user_id !== null

  function close() {
    setOpen(false)
    setPicked(null)
    setQuery('')
    merge.reset()
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">중복 사람 합치기</h2>
      {picked ? (
        <>
          <p role="status" className="text-sm leading-relaxed text-gray-700">
            {label(picked)} 의 기록·자녀·계정을 {label(person)} 로 옮기고, {picked.name} 행은 익명 처리해요. 되돌릴 수 없어요.
          </p>
          {merge.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(merge.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPicked(null)} disabled={merge.isPending}>그만두기</Button>
            <Button
              onClick={() => merge.mutate(picked.id, { onSuccess: () => { onDone(`${person.name} 님으로 합쳤어요`); close() } })}
              disabled={merge.isPending}
            >
              {merge.isPending ? '처리 중…' : '합치기'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <TextField label="합칠 사람 찾기" name="merge-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 번호 뒷자리" autoComplete="off" />
          {merge.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(merge.error)}</p>}
          {query.trim().length < MIN_QUERY ? (
            <p className="text-sm text-gray-500">두 글자 또는 번호 뒷자리를 넣어 주세요</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-500">찾는 사람이 없어요</p>
          ) : (
            <ul aria-label="합칠 사람 후보" className="flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{label(p)}</span>
                  <div className="shrink-0 text-right">
                    <button
                      type="button"
                      onClick={() => setPicked(p)}
                      disabled={bothLinked(p)}
                      aria-label={`${p.name} 선택`}
                      className="px-3 py-2 text-xs text-blue-600 underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      선택
                    </button>
                    {bothLinked(p) && <p className="text-xs text-gray-500">둘 다 카카오 계정이 있어요 — 한쪽을 먼저 초기화해 주세요</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" onClick={close}>닫기</Button>
        </>
      )}
    </section>
  )
}
