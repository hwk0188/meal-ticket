import { useState } from 'react'
import { Link } from 'react-router'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Spinner, TextField } from '../../components/ui'
import { filterPeople, type DecoratedPerson, type PeopleFilter } from '../../features/admin/peopleFilter'
import { MAX_PEOPLE, useAllPeople } from '../../features/admin/useAllPeople'
import { formatDate } from '../../lib/dates'
import { formatPhone } from '../../lib/phone'

const FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'unlinked', label: '미가입' },
  { value: 'admin', label: '관리자' },
] as const satisfies readonly { value: PeopleFilter; label: string }[]

/** 빈 목록의 이유를 구분해 말해 준다 — 모두 가입한 교회에서 "미가입" 칩을 눌렀다면 좋은 소식이다. */
function emptyMessage(query: string, filter: PeopleFilter): string {
  if (query.trim()) return '찾는 사람이 없어요'
  if (filter === 'unlinked') return '미가입인 사람이 없어요'
  if (filter === 'admin') return '관리자가 없어요'
  return '아직 등록된 사람이 없어요'
}

/** `#/admin/people` — 사람 목록 (설계 §8.3). 전체를 한 번 읽고 검색·필터는 클라이언트에서 한다. */
export function AdminPeoplePage() {
  const people = useAllPeople()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PeopleFilter>('all')
  const shown = people.data ? filterPeople(people.data, query, filter) : []

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">사람</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* status 가 아니라 data 로 분기한다 (공통 규약) */}
      {people.data ? (
        <>
          {people.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 목록을 받지 못했어요</p>}
          {/* PostgREST 가 max_rows 에서 조용히 자른다 — 사람이 목록에서 사라지는 걸 말없이 두지 않는다. */}
          {people.data.length === MAX_PEOPLE && (
            <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              사람이 너무 많아 {MAX_PEOPLE}명까지만 불러왔어요. 목록에 없는 분이 있을 수 있어요.
            </p>
          )}
          <TextField label="이름 또는 번호 뒷자리" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="두 글자부터 쉽게 찾아요" autoComplete="off" />
          <SegmentedControl label="사람 필터" value={filter} onChange={setFilter} options={FILTERS} />
          {/* 검색으로 목록이 좁혀진 것을 스크린리더에도 알린다 (검색 결과 수 라이브 영역) */}
          <p role="status" className="text-xs text-gray-500">{shown.length}명</p>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">{emptyMessage(query, filter)}</p>
          ) : (
            <ul aria-label="사람 목록" className="flex flex-col gap-2">
              {shown.map((p) => <PersonLine key={p.id} person={p} />)}
            </ul>
          )}
        </>
      ) : people.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          사람을 불러오지 못했어요
          <button type="button" onClick={() => void people.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

/**
 * 한 줄: 이름 · 태그 · 전체 번호 · 가족 힌트 · 가족 수. 줄 전체가 상세로 가는 링크다.
 *
 * 링크에 `aria-label` 을 직접 준다. 그냥 두면 접근성 이름이 줄 내용 그대로여서
 * ① 이름과 첫 태그 사이에 공백 텍스트 노드가 없어 "권사관리자" 로 읽히고,
 * ② 번호 없는 동명이인 두 줄의 이름이 완전히 같아진다 (AdminMealsPage 의 선례와 같은 처리).
 * 등록일은 눈에는 안 보이지만 이름에 넣어, 가족 힌트까지 같은 극단적인 경우에도 줄이 갈린다.
 */
function PersonLine({ person }: { person: DecoratedPerson }) {
  const phone = person.phone ? formatPhone(person.phone) : '번호 없음'
  const familySize = person.familySize > 1 ? `가족 ${person.familySize}명` : null
  const name = [person.name, ...person.tags, person.familyHint, phone, familySize, `등록 ${formatDate(person.created_at)}`]
    .filter((part) => part !== null)
    .join(' ')
  return (
    <li>
      <Link
        to={`/admin/people/${person.id}`}
        aria-label={name}
        className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm font-bold">
            <span className="truncate">{person.name}</span>
            {person.tags.map((tag) => (
              <span key={tag} className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">{tag}</span>
            ))}
          </div>
          {/* 전체 번호는 관리자 화면에서만 보여 준다 (설계 §10) */}
          <div className="text-xs text-gray-500">{person.familyHint ? `${phone} · ${person.familyHint}` : phone}</div>
        </div>
        {familySize && <span className="shrink-0 text-xs text-gray-500">{familySize}</span>}
      </Link>
    </li>
  )
}
