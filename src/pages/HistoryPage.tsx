import { Spinner } from '../components/ui'
import { useCurrentPerson } from '../features/auth/usePerson'
import type { LedgerEntry } from '../features/history/mergeLedger'
import { useFamilyLedger } from '../features/history/useFamilyLedger'
import { formatDateTime, formatShortDate } from '../lib/dates'
import { formatWon } from '../lib/money'

export function HistoryPage() {
  const person = useCurrentPerson()
  const ledger = useFamilyLedger(person)

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <h1 className="text-lg font-extrabold">내역</h1>
      {/* status 가 아니라 data 로 분기한다 — 포커스 복귀 재조회가 실패해도 보던 목록이 사라지지 않게 (공통 규약) */}
      {ledger.data ? (
        ledger.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">아직 내역이 없어요</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ledger.data.map((entry) => <Entry key={`${entry.kind}-${entry.id}`} entry={entry} />)}
          </ul>
        )
      ) : ledger.status === 'error' ? (
        <p role="alert" className="text-center text-sm text-red-600">내역을 불러오지 못했어요</p>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function Entry({ entry }: { entry: LedgerEntry }) {
  const struck = entry.kind === 'issuance' ? entry.cancelled : entry.voided
  const servedOn = entry.servedOn ? `${formatShortDate(entry.servedOn)} ` : ''
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-400' : ''}`}>
      {entry.kind === 'issuance' ? (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>발급 {entry.quantity}장 · {formatWon(entry.amount)}</div>
          <div className="text-xs">
            {formatDateTime(entry.at)} · {servedOn}{entry.mealTitle} · {entry.issuer}{entry.memo ? ` · ${entry.memo}` : ''}
          </div>
          {entry.cancelled && <div className="text-xs font-bold">취소됨</div>}
        </>
      ) : (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>
            사용 1장 · {entry.via === 'admin' ? '담당자 처리' : `${entry.person} 폰`}
          </div>
          <div className="text-xs">{formatDateTime(entry.at)} · {entry.mealTitle}</div>
          {entry.voided && <div className="text-xs font-bold">무효</div>}
        </>
      )}
    </li>
  )
}
