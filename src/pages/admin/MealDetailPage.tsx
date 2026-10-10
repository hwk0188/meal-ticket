import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Spinner, TextField } from '../../components/ui'
import { filterFamilies, type FamilyGroup, type MealIssuance, type MealUsage } from '../../features/admin/groupMealLedger'
import { useMealDetail } from '../../features/admin/useMealDetail'
import { formatDateTime, formatMealDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'

/** `#/admin/meals/:mealId` — 식사 하나의 현황판 (설계 §8.3). 발급·사용·남음·금액, 이름 검색, 가족별 명단. 5초 폴링은 훅이 한다. */
export function MealDetailPage() {
  const { mealId = '' } = useParams()
  const detail = useMealDetail(mealId)
  const [query, setQuery] = useState('')

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/admin/meals" className="text-sm text-blue-600 underline">← 식사</Link>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* data 로 분기한다 (공통 규약). 이 화면은 null 이 "식사 없음" 이라는 정상 값이라 undefined 와 구분한다. */}
      {detail.data !== undefined ? (
        detail.data === null ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
            식사를 찾을 수 없어요. 목록으로 돌아가 주세요.
          </p>
        ) : (
          <>
            <h1 className="text-lg font-extrabold">{formatMealDate(detail.data.meal.served_on)} · {detail.data.meal.title}</h1>
            {detail.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 현황을 받지 못했어요</p>}
            <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold">
              발급 {detail.data.ledger.totals.issued}장 · 사용 {detail.data.ledger.totals.used}장 · 남음 {detail.data.ledger.totals.remaining}장 · {formatWon(detail.data.ledger.totals.amount)}
            </p>
            <TextField label="이름으로 찾기" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자 이름" autoComplete="off" />
            <FamilyList families={filterFamilies(detail.data.ledger.families, query)} searching={query.trim() !== ''} />
          </>
        )
      ) : detail.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          현황을 불러오지 못했어요
          <button type="button" onClick={() => void detail.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function FamilyList({ families, searching }: { families: readonly FamilyGroup[]; searching: boolean }) {
  if (families.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{searching ? '찾는 가족이 없어요' : '아직 발급이 없어요'}</p>
  return (
    <ul aria-label="가족별 현황" className="flex flex-col gap-2">
      {families.map((f) => <FamilyBlock key={f.familyId} family={f} />)}
    </ul>
  )
}

/** 가족 한 블록: 구매자 이름들 · "N장 중 M장 사용" · 남음·금액 · 발급 줄 · 사용 줄 */
function FamilyBlock({ family }: { family: FamilyGroup }) {
  return (
    <li aria-label={family.label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate font-bold" title={family.label}>{family.label}</h2>
        <span className="shrink-0 text-sm">{family.issued}장 중 {family.used}장 사용</span>
      </div>
      <p className="text-xs text-gray-500">남음 {family.remaining}장 · {formatWon(family.amount)}</p>
      <ul aria-label="발급·사용 내역" className="mt-2 flex flex-col gap-2 text-sm">
        {family.issuances.map((i) => <IssuanceLine key={i.id} issuance={i} />)}
        {family.usages.map((u) => <UsageLine key={u.id} usage={u} />)}
      </ul>
    </li>
  )
}

function IssuanceLine({ issuance: i }: { issuance: MealIssuance }) {
  return (
    <li className={i.cancelled ? 'text-gray-500' : ''}>
      <div className={i.cancelled ? 'line-through' : ''}>발급 {i.quantity}장 · {i.buyer || '(이름 없음)'} · {formatWon(i.amount)}</div>
      <div className="text-xs text-gray-500">{formatDateTime(i.issuedAt)} · {i.issuer}{i.memo ? ` · ${i.memo}` : ''}</div>
      {i.cancelled && <div className="text-xs font-bold">취소됨{i.cancelReason ? ` · ${i.cancelReason}` : ''}</div>}
    </li>
  )
}

function UsageLine({ usage: u }: { usage: MealUsage }) {
  // admin 이면 person 은 "누구 몫으로", self 면 "어느 폰에서". 이름이 가려졌으면(탈퇴) 자리를 비우지 않는다.
  const who = u.via === 'admin' ? `${u.person || '가족'} 몫 · 담당자 처리` : `${u.person || '가족'} 폰`
  return (
    <li className={u.voided ? 'text-gray-500' : ''}>
      <div className={u.voided ? 'line-through' : ''}>사용 1장 · {who}</div>
      <div className="text-xs text-gray-500">{formatDateTime(u.usedAt)}</div>
      {u.voided && <div className="text-xs font-bold">무효</div>}
    </li>
  )
}
