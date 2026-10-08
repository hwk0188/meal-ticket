import { formatMealDate } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { Clock } from './Clock'
import type { TicketGroup, Usage } from './groupTickets'
import { TicketList } from './TicketList'
import type { Member } from './useFamilyTickets'
import { useUseTicket } from './useUseTicket'

type Props = { group: TicketGroup; usages: readonly Usage[]; members: readonly Member[]; online: boolean }

/** 오늘 식사 한 끼: 식사명·날짜·실시간 시계·남은 장수·식권 목록·사용 처리 상태 */
export function TodayMealCard({ group, usages, members, online }: Props) {
  const { meal, issued, used, remaining } = group
  const mutation = useUseTicket(meal.id)
  const mealUsages = usages.filter((u) => u.meal_id === meal.id)
  const canUse = online && remaining > 0 && !mutation.isPending

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby={`meal-${meal.id}`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500">오늘 · {formatMealDate(meal.served_on)}</p>
          <h2 id={`meal-${meal.id}`} className="text-lg font-extrabold">{meal.title}</h2>
        </div>
        <div className="text-right">
          <Clock />
          <p className="text-sm font-bold text-blue-600">{remaining}장 남음</p>
        </div>
      </header>

      {issued === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">이 식사의 식권이 없어요</p>
      ) : (
        <>
          <TicketList issued={issued} used={used} usages={mealUsages} members={members} canUse={canUse} pending={mutation.isPending} onUse={() => mutation.mutate()} />
          {remaining > 0 && <p className="text-center text-xs text-gray-500">담당자가 식권을 꾹 눌러 주세요</p>}
        </>
      )}

      {mutation.isPending && <p role="status" className="text-center text-sm text-gray-600">처리 중…</p>}
      {mutation.isSuccess && !mutation.isPending && <p role="status" className="text-center text-sm font-bold text-green-700">사용 처리되었어요 ✓</p>}
      {mutation.isError && <p role="alert" className="text-center text-sm text-red-600">{toUserMessage(mutation.error)}</p>}
    </section>
  )
}
