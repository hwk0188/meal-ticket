import { useState } from 'react'
import { Link } from 'react-router'
import { Button, Spinner } from '../../components/ui'
import { MealForm } from '../../features/admin/MealForm'
import { nextSundayLunchDate } from '../../features/admin/nextSundayLunch'
import { summarizeByMeal, type MealSummary } from '../../features/admin/summarizeByMeal'
import { addMealErrorMessage, useAddMeal, useAdminBalances, useCreateNextSundayLunch, useDeleteMeal, useMeals } from '../../features/admin/useMeals'
import type { Meal } from '../../features/tickets/groupTickets'
import { formatMealDate, formatShortDate, todaySeoul } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatWon } from '../../lib/money'

export function AdminMealsPage() {
  const today = todaySeoul()
  const meals = useMeals()
  const balances = useAdminBalances()
  const createNext = useCreateNextSundayLunch()
  const addMeal = useAddMeal()
  const deleteMeal = useDeleteMeal()
  const [adding, setAdding] = useState(false)

  const loaded = meals.data && balances.data
  const failed = meals.status === 'error' || balances.status === 'error'
  const list = meals.data ?? []
  const summary = summarizeByMeal(balances.data ?? [])
  const upcoming = list.filter((m) => m.served_on >= today).toSorted((a, b) => a.served_on.localeCompare(b.served_on) || a.title.localeCompare(b.title, 'ko'))
  const past = list.filter((m) => m.served_on < today).toSorted((a, b) => b.served_on.localeCompare(a.served_on) || a.title.localeCompare(b.title, 'ko'))

  function onDelete(meal: Meal) {
    deleteMeal.reset()
    if (window.confirm(`${formatMealDate(meal.served_on)} ${meal.title} 식사를 지울까요?`)) deleteMeal.mutate(meal.id)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">식사</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      <Button onClick={() => { createNext.reset(); createNext.mutate() }} disabled={createNext.isPending || !loaded}>
        + 다음 주일 점심 만들기 ({formatShortDate(nextSundayLunchDate(list, today))})
      </Button>
      {createNext.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(createNext.error)}</p>}

      {adding ? (
        <MealForm today={today} pending={addMeal.isPending} onCancel={() => { addMeal.reset(); setAdding(false) }}
          onSubmit={(values) => addMeal.mutate(values, { onSuccess: () => setAdding(false) })} />
      ) : (
        <Button variant="ghost" onClick={() => { addMeal.reset(); setAdding(true) }}>+ 식사 직접 추가</Button>
      )}
      {addMeal.isError && <p role="alert" className="text-sm text-red-600">{addMealErrorMessage(addMeal.error)}</p>}
      {deleteMeal.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(deleteMeal.error)}</p>}

      {/* status 가 아니라 data 로 분기한다 (공통 규약): 재조회 실패에도 보던 목록은 남긴다. 식사·잔량 두 조회가 모두 있어야 카드를 그린다 — 잔량이 없으면 모든 카드가 "발급 0" 으로 보이고 지울 수 있게 돼 버린다. */}
      {loaded ? (
        <>
          {failed && <p role="status" className="text-center text-xs text-gray-500">최신 목록을 받지 못했어요</p>}
          <section aria-label="다가오는 식사" className="flex flex-col gap-2">
            <h2 className="text-xs font-bold text-gray-500">다가오는 식사</h2>
            {upcoming.length === 0 && <p className="text-sm text-gray-500">예정된 식사가 없어요</p>}
            {upcoming.map((m) => <MealCard key={m.id} meal={m} summary={summary.get(m.id)} onDelete={onDelete} deleting={deleteMeal.isPending} />)}
          </section>
          {past.length > 0 && (
            <details className="flex flex-col gap-2">
              <summary className="cursor-pointer text-xs font-bold text-gray-500">지난 식사 {past.length}건</summary>
              <div className="mt-2 flex flex-col gap-2">
                {past.map((m) => <MealCard key={m.id} meal={m} summary={summary.get(m.id)} onDelete={onDelete} deleting={deleteMeal.isPending} />)}
              </div>
            </details>
          )}
        </>
      ) : failed ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          식사를 불러오지 못했어요
          <button type="button" onClick={() => { void meals.refetch(); void balances.refetch() }} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function MealCard({ meal, summary, onDelete, deleting }: { meal: Meal; summary?: MealSummary; onDelete: (m: Meal) => void; deleting: boolean }) {
  const s = summary ?? { issued: 0, used: 0, amount: 0, families: 0 }
  const rate = s.issued > 0 ? Math.round((s.used / s.issued) * 100) : 0
  const label = `${formatMealDate(meal.served_on)} ${meal.title}`
  return (
    <article aria-label={label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500">{formatMealDate(meal.served_on)}</p>
          <h3 className="font-bold">{meal.title}</h3>
          {meal.note && <p className="text-xs text-gray-500">{meal.note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link to={`/admin/meals/${meal.id}`} aria-label={`${label} 현황`} className="-my-2 px-2 py-2 text-xs text-blue-600 underline">현황</Link>
          {/* 발급이 있으면 FK 가 막으므로 버튼 자체를 감춘다 */}
          {s.issued === 0 && (
            <button type="button" onClick={() => onDelete(meal)} disabled={deleting} aria-label={`${label} 삭제`} className="text-xs text-red-600 underline">삭제</button>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm">발급 {s.issued}장 · 가족 {s.families} · {formatWon(s.amount)}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <div className="h-2 flex-1 overflow-hidden rounded bg-gray-200" aria-hidden><div className="h-full bg-blue-600" style={{ width: `${rate}%` }} /></div>
        <span>사용 {s.used} / {s.issued}</span>
      </div>
    </article>
  )
}
