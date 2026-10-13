import { useMemo, useState } from 'react'
import { Button, Spinner, TextField } from '../../components/ui'
import { useAllPeople } from '../../features/admin/useAllPeople'
import { useMonthLedger } from '../../features/admin/useMonthLedger'
import { canShareCsv, downloadCsv, shareCsv } from '../../features/admin/shareCsv'
import { csvFilename, toCsv } from '../../features/admin/statsCsv'
import { currentMonth, formatMonth, shiftMonth } from '../../features/admin/statsMonth'
import { byMeal, filterByName, repByFamily, summarizeMonth, toStatsRows, type StatsRow } from '../../features/admin/statsRows'
import { formatMealDate, formatSeoulStamp, todaySeoul } from '../../lib/dates'
import { formatWon } from '../../lib/money'

/** `#/admin/stats` — 월 통계 (설계 §8.3). 그 달 식사의 장부를 한 번 읽어 합계·식사별·검색·CSV 를 모두 만든다. */
export function StatsPage() {
  const [month, setMonth] = useState(() => currentMonth(todaySeoul()))
  const [query, setQuery] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)
  const ledger = useMonthLedger(month)
  const people = useAllPeople()
  // 공유 지원은 브라우저마다 고정이라 한 번만 묻는다 (설계대로 미지원이면 버튼을 아예 그리지 않는다)
  const shareable = useMemo(() => canShareCsv(), [])

  const reps = useMemo(() => repByFamily(people.data ?? []), [people.data])
  const rows = useMemo(() => (ledger.data ? toStatsRows(ledger.data, reps) : []), [ledger.data, reps])
  const searching = query.trim() !== ''
  const shown = useMemo(() => (searching ? filterByName(rows, query) : rows), [rows, query, searching])
  const totals = useMemo(() => summarizeMonth(rows), [rows])
  const found = useMemo(() => summarizeMonth(shown), [shown])
  const meals = useMemo(() => byMeal(rows), [rows])

  function onDownload() {
    setShareError(null)
    downloadCsv(csvFilename(month), toCsv(rows))
  }
  async function onShare() {
    setShareError(null)
    try {
      await shareCsv(csvFilename(month), toCsv(rows))
    } catch {
      setShareError('공유하지 못했어요. CSV 저장으로 받아 주세요.')
    }
  }
  function go(delta: number) {
    setShareError(null)
    setMonth((m) => shiftMonth(m, delta))
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">통계</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* 식사일 기준 월 선택. input[type=month] 는 브라우저마다 달라 좌우 버튼으로 둔다. */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-2 py-1">
        <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="px-4 py-2 text-lg text-blue-600">◀</button>
        <span className="text-sm font-bold">{formatMonth(month)}</span>
        <button type="button" onClick={() => go(1)} aria-label="다음 달" className="px-4 py-2 text-lg text-blue-600">▶</button>
      </div>

      {/* status 가 아니라 data 로 분기한다 (공통 규약): 재조회 실패에도 보던 숫자는 남긴다. */}
      {ledger.data ? (
        <>
          {ledger.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 기록을 받지 못했어요</p>}
          {ledger.data.truncated && (
            <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              기록이 너무 많아 일부만 보여요. 월을 나눠 확인해 주세요.
            </p>
          )}

          <p role="status" aria-label="이 달 합계" className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-bold">
            발급 {totals.issued}장 · 사용 {totals.used}장 · {formatWon(totals.amount)}
          </p>

          <div className="flex gap-2">
            <Button onClick={onDownload} disabled={rows.length === 0}>이 달 CSV 저장</Button>
            {shareable && <Button variant="ghost" onClick={() => void onShare()} disabled={rows.length === 0}>카톡으로 공유</Button>}
          </div>
          {shareError && <p role="alert" className="text-sm text-red-600">{shareError}</p>}

          <TextField label="이름으로 찾기" name="stats-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자·가족 대표" autoComplete="off" />

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">이 달에는 발급·사용 기록이 없어요</p>
          ) : searching ? (
            shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">그 이름으로 찾은 기록이 없어요</p>
            ) : (
              <>
                <p role="status" aria-label="찾은 합계" className="text-xs text-gray-500">
                  {shown.length}건 · 발급 {found.issued}장 · 사용 {found.used}장 · {formatWon(found.amount)}
                </p>
                <ul aria-label="찾은 장부" className="flex flex-col gap-2">
                  {shown.map((r) => <LedgerLine key={`${r.kind}-${r.mealId}-${r.at}-${r.name}`} row={r} />)}
                </ul>
              </>
            )
          ) : (
            <ul aria-label="식사별 합계" className="flex flex-col gap-2">
              {meals.map((m) => (
                <li key={m.mealId} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-bold">{m.mealTitle}</span>
                    <span className="shrink-0 text-xs text-gray-500">{formatMealDate(m.servedOn)}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">발급 {m.issued}장 · 사용 {m.used}장 · {formatWon(m.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : ledger.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          기록을 불러오지 못했어요
          <button type="button" onClick={() => void ledger.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function LedgerLine({ row: r }: { row: StatsRow }) {
  const struck = r.kind === '취소' || r.kind === '무효'
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-500' : ''}`}>
      <div className={`font-bold ${struck ? 'line-through' : ''}`}>
        {r.kind} {r.quantity}장{r.amount === null ? '' : ` · ${formatWon(r.amount)}`}
      </div>
      <div className="text-xs text-gray-500">
        {formatSeoulStamp(r.at)} · {r.mealTitle} · {r.name || '(이름 없음)'} · {r.handler || '관리자'}
        {r.memo ? ` · ${r.memo}` : ''}
      </div>
    </li>
  )
}
