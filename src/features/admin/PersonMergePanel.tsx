import { useEffect, useRef, useState } from 'react'
import { Button, Spinner, TextField } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { formatPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { filterPeople, type DecoratedPerson } from './peopleFilter'
import { MAX_PEOPLE, useAllPeople } from './useAllPeople'
import { personOpsErrorMessage, useMergePeople } from './usePersonOps'

type Props = { person: Person; editing?: boolean; onDone: (message: string) => void; onStart?: () => void }

/** 후보를 두 글자부터 보여 준다 — 열자마자 전 교인 명단이 쏟아지면 잘못 고를 위험만 커진다. */
const MIN_QUERY = 2
/** 남아 있는 사람(지금 보는 페이지) 쪽 표시. h1 이 이미 맥락을 주므로 이름(번호)로 충분하다. */
const label = (p: Person) => `${p.name}(${p.phone ? formatPhone(p.phone) : '번호 없음'})`
/**
 * 되돌릴 수 없는 동작이라 후보를 가리키는 모든 자리(후보 줄·선택 버튼의 접근성 이름·확인 문구의 picked 쪽)에
 * 같은 꼬리표를 쓴다. 번호 없는 동명이인은 이름·번호가 모두 같아질 수 있어 AdminPeoplePage 와 같은 조합
 * (가족 힌트·등록일) 으로 갈라 준다.
 */
const detail = (p: DecoratedPerson) =>
  [p.phone ? formatPhone(p.phone) : '번호 없음', p.familyHint, `등록 ${formatDate(p.created_at)}`]
    .filter((part) => part !== null)
    .join(' · ')
const candidate = (p: DecoratedPerson) => `${p.name}(${detail(p)})`

/**
 * 중복 사람 합치기. 보고 있는 사람이 **남는 쪽**(into), 고른 사람이 **익명 처리되는 쪽**(from) 이다.
 * 방향을 틀리면 되돌릴 수 없으므로 확인 문구에 두 사람의 이름·번호를 모두 적는다.
 */
export function PersonMergePanel({ person, editing = false, onDone, onStart }: Props) {
  const people = useAllPeople()
  const merge = useMergePeople(person.id)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DecoratedPerson | null>(null)

  // "수정" 폼이 열리면 이 패널의 지난 오류는 치운다 — 저장 성공 알림 위에 무관한 합치기 오류가 남지 않게.
  // merge.reset 은 매 렌더 새 참조라(useMutation), effect 의존 배열에 그대로 넣으면 editing 과 무관하게 매번 돈다 —
  // ref 에 최신 함수만 담아 두고(useHold 의 latest 와 같은 요령) editing 전환에만 반응한다.
  const mergeReset = useRef(merge.reset)
  useEffect(() => {
    mergeReset.current = merge.reset
  }, [merge.reset])
  useEffect(() => {
    if (editing) mergeReset.current()
  }, [editing])

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
            {candidate(picked)} 의 기록·자녀·계정을 {label(person)} 로 옮기고, {picked.name} 행은 익명 처리해요. 되돌릴 수 없어요.
          </p>
          {merge.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(merge.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" aria-label="합치기 그만두기" onClick={() => { setPicked(null); merge.reset() }} disabled={merge.isPending}>
              그만두기
            </Button>
            <Button
              onClick={() => {
                onStart?.()
                merge.mutate(picked.id, { onSuccess: () => { onDone(`${person.name} 님으로 합쳤어요`); close() } })
              }}
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
          {people.data === undefined ? (
            // data 가 아니라 status 를 본다 — 읽지 못한 것(대기·실패)을 "중복이 없다" 로 접지 않는다.
            people.status === 'error' ? (
              <p role="alert" className="text-sm text-red-600">사람 목록을 불러오지 못해 후보를 찾을 수 없어요</p>
            ) : (
              <Spinner inline />
            )
          ) : (
            <>
              {/* PostgREST 가 max_rows 에서 조용히 자른다 (AdminPeoplePage 와 같은 안내) — 검색어와 무관하게 보여 준다. */}
              {people.data.length === MAX_PEOPLE && (
                <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  사람이 너무 많아 {MAX_PEOPLE}명까지만 불러왔어요. 목록에 없는 분이 있을 수 있어요.
                </p>
              )}
              {query.trim().length < MIN_QUERY ? (
                <p className="text-sm text-gray-500">두 글자 또는 번호 뒷자리를 넣어 주세요</p>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-gray-500">찾는 사람이 없어요</p>
              ) : (
                <ul aria-label="합칠 사람 후보" className="flex flex-col gap-2">
                  {candidates.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words">{candidate(p)}</span>
                      <div className="shrink-0 text-right">
                        <button
                          type="button"
                          onClick={() => setPicked(p)}
                          disabled={bothLinked(p)}
                          aria-label={`${candidate(p)} 선택`}
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
            </>
          )}
          <Button variant="ghost" onClick={close}>닫기</Button>
        </>
      )}
    </section>
  )
}
