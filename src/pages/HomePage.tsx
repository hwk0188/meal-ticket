import { Link } from 'react-router'
import { SignOutButton } from '../components/SignOutButton'
import { Spinner } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import type { Person } from '../features/auth/usePerson'
import type { TicketGroup } from '../features/tickets/groupTickets'
import { TodayMealCard } from '../features/tickets/TodayMealCard'
import { useFamilyTickets, type FamilyTickets } from '../features/tickets/useFamilyTickets'
import { useOnline } from '../features/tickets/useOnline'
import { formatMealDate, formatShortDate } from '../lib/dates'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  const tickets = useFamilyTickets(person)
  const online = useOnline()

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-extrabold">{person.name} 님</h1>
          {/* data 가 아직 없을 때(처음 불러오는 중) "내 식권" 이 잠깐 떴다 가족 수로 바뀌는 깜빡임을 막는다 */}
          {tickets.data && (
            <p className="text-xs text-gray-500">
              {tickets.data.members.length > 1 ? `우리 가족 식권 · ${tickets.data.members.length}명` : '내 식권'}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-gray-600">
          <div>{maskPhone(person.phone)}</div>
          {!online && <div className="mt-1 rounded bg-gray-200 px-2 py-0.5 font-bold">오프라인 · 사용 처리 불가</div>}
        </div>
      </header>

      {/* 폴링 중 한 번의 요청 실패로 목록이 사라지면(이미 읽은 data 가 있는데도) 꾹 누르는 중인 행이 통째로
          사라질 수 있다. data 가 있으면 그대로 보여 주고, 실패는 조용한 안내 한 줄로만 알린다. */}
      {tickets.data ? (
        <>
          {tickets.status === 'error' && (
            <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요. 다시 시도하는 중…</p>
          )}
          <Tickets data={tickets.data} online={online} />
        </>
      ) : tickets.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          식권을 불러오지 못했어요
          <button type="button" onClick={() => void tickets.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}

      <div className="flex-1" />
      <Footer />
    </main>
  )
}

function Tickets({ data, online }: { data: FamilyTickets; online: boolean }) {
  const next = data.upcoming[0]
  return (
    <>
      {data.today.length === 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
          <div className="mb-2 text-3xl" aria-hidden>🍚</div>
          <p className="text-sm">오늘은 식사가 없어요</p>
        </section>
      ) : (
        data.today.map((group) => <TodayMealCard key={group.meal.id} group={group} usages={data.usages} members={data.members} online={online} />)
      )}

      {data.today.length > 0 && next && (
        <p className="text-center text-xs text-gray-500">다음 · {formatShortDate(next.meal.served_on)} {next.meal.title} · {next.remaining}장</p>
      )}
      {data.today.length === 0 && data.upcoming.length > 0 && <GroupList title="다가오는 식권" groups={data.upcoming} />}
      {data.past.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-gray-600">지난 식권 {data.past.length}건</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {data.past.map((g) => (
              <li key={g.meal.id} className="flex justify-between text-gray-600">
                <span>{formatShortDate(g.meal.served_on)} {g.meal.title}</span>
                <span>{g.remaining > 0 ? `미사용 ${g.remaining}장` : `${g.used}장 사용`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function GroupList({ title, groups }: { title: string; groups: TicketGroup[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-bold text-gray-500">{title}</h2>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.meal.id} className="flex items-center justify-between text-sm">
            <span>{formatMealDate(g.meal.served_on)} · {g.meal.title}</span>
            <span className="font-bold">{g.remaining}장</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const CHILD_SIGN_OUT_NOTICE = '아이 계정은 로그아웃하면 보호자가 새 코드로 다시 연결해야 해요. 정말 로그아웃할까요?'

function Footer() {
  const auth = useAuth()
  // 익명(아이) 계정은 로그아웃하면 그 계정을 되찾을 수 없다 (비밀번호도 카카오도 없다). 한 번 더 묻는다.
  const anonymous = auth.status === 'ready' && auth.session?.user.is_anonymous === true
  return (
    <footer className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-4">
        <Link to="/privacy" className="px-3 py-2 text-xs text-gray-600 underline">개인정보 처리방침</Link>
      </div>
      <SignOutButton message={anonymous ? CHILD_SIGN_OUT_NOTICE : undefined} />
    </footer>
  )
}
