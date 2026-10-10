import { useState } from 'react'
import { Link } from 'react-router'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Spinner, TextField } from '../../components/ui'
import { filterPeople, type DecoratedPerson, type PeopleFilter } from '../../features/admin/peopleFilter'
import { useAllPeople } from '../../features/admin/useAllPeople'
import { formatPhone } from '../../lib/phone'

const FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'unlinked', label: '미가입' },
  { value: 'admin', label: '관리자' },
] as const satisfies readonly { value: PeopleFilter; label: string }[]

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
          <TextField label="이름 또는 번호 뒷자리" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="두 글자부터 쉽게 찾아요" autoComplete="off" />
          <SegmentedControl label="사람 필터" value={filter} onChange={setFilter} options={FILTERS} />
          <p className="text-xs text-gray-500">{shown.length}명</p>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">찾는 사람이 없어요</p>
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

/** 한 줄: 이름 · 태그 · 전체 번호 · 가족 수. 줄 전체가 상세로 가는 링크다. */
function PersonLine({ person }: { person: DecoratedPerson }) {
  return (
    <li>
      <Link
        to={`/admin/people/${person.id}`}
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
          <div className="text-xs text-gray-500">{person.phone ? formatPhone(person.phone) : '번호 없음'}</div>
        </div>
        {person.familySize > 1 && <span className="shrink-0 text-xs text-gray-500">가족 {person.familySize}명</span>}
      </Link>
    </li>
  )
}
