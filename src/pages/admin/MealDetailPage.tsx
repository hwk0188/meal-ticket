import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Spinner, TextField } from '../../components/ui'
import { filterFamilies, NO_NAME, type FamilyGroup, type MealIssuance, type MealUsage } from '../../features/admin/groupMealLedger'
import { useMealDetail } from '../../features/admin/useMealDetail'
import { mealOpsErrorMessage, useCancelIssuance, useUseTicketAsAdmin, useVoidUsage } from '../../features/admin/useMealOps'
import { formatDateTime, formatMealDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'

type Actions = {
  pending: boolean
  onCancel: (issuance: MealIssuance) => void
  onVoid: (usage: MealUsage) => void
  onUseAsAdmin: (family: FamilyGroup) => void
}

// 사용 줄과 알림에 공통으로 쓰는 "누구 몫으로/어느 폰에서" 문구. admin 이면 담당자가 대신 처리했다는 뜻.
function usageWho(u: MealUsage): string {
  return u.via === 'admin' ? `${u.person || '가족'} 몫 · 담당자 처리` : `${u.person || '가족'} 폰`
}

/** `#/admin/meals/:mealId` — 식사 하나의 현황판 (설계 §8.3). 발급·사용·남음·금액, 이름 검색, 가족별 명단 + 취소·대신 사용·무효. 5초 폴링은 훅이 한다. */
export function MealDetailPage() {
  const { mealId = '' } = useParams()
  const detail = useMealDetail(mealId)
  const cancel = useCancelIssuance(mealId)
  const voidUsage = useVoidUsage(mealId)
  const useAsAdmin = useUseTicketAsAdmin(mealId)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  const pending = cancel.isPending || voidUsage.isPending || useAsAdmin.isPending
  // 관리자 맥락 문구(no_remaining 은 교인 폰 문구가 아니라 "남은 식권이 없어요")
  const opsError = cancel.isError
    ? mealOpsErrorMessage(cancel.error)
    : voidUsage.isError
      ? mealOpsErrorMessage(voidUsage.error)
      : useAsAdmin.isError
        ? mealOpsErrorMessage(useAsAdmin.error)
        : null

  // 피드백(성공 알림·오류)이 생기면 그 영역으로 포커스를 옮긴다 — 눌렸던 버튼이 성공으로 사라질 때 포커스를 잃지 않게 한다.
  useEffect(() => {
    if (notice || opsError) feedbackRef.current?.focus()
  }, [notice, opsError])

  // 다음 동작이 시작되면 이전 동작의 오류·알림을 지운다 (공통 규약)
  function clearFeedback() {
    cancel.reset()
    voidUsage.reset()
    useAsAdmin.reset()
    setNotice(null)
  }
  const actions: Actions = {
    pending,
    onCancel: (i) => {
      clearFeedback()
      cancel.mutate(i.id, { onSuccess: () => setNotice(`${i.buyer ? `${i.buyer} 님` : NO_NAME} ${i.quantity}장 발급을 취소했어요`) })
    },
    onVoid: (u) => {
      clearFeedback()
      voidUsage.mutate(u.id, { onSuccess: () => setNotice(`${usageWho(u)} 사용을 무효 처리했어요`) })
    },
    onUseAsAdmin: (f) => {
      if (!f.buyerId) return // 버튼이 이미 잠겨 있어 도달하지 않는다 (타입 좁히기용)
      clearFeedback()
      useAsAdmin.mutate({ personId: f.buyerId, familyId: f.familyId }, { onSuccess: () => setNotice(`${f.label} 가족 식권 1장을 사용 처리했어요`) })
    },
  }

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
            {(notice || opsError) && (
              <div ref={feedbackRef} tabIndex={-1} className="sticky top-0 z-10 flex flex-col gap-2 outline-none">
                {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}
                {opsError && <p role="alert" className="text-sm text-red-600">{opsError}</p>}
              </div>
            )}
            <TextField label="이름으로 찾기" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자 이름" autoComplete="off" />
            <FamilyList families={filterFamilies(detail.data.ledger.families, query)} searching={query.trim() !== ''} actions={actions} />
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

function FamilyList({ families, searching, actions }: { families: readonly FamilyGroup[]; searching: boolean; actions: Actions }) {
  if (families.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{searching ? '찾는 가족이 없어요' : '아직 발급이 없어요'}</p>
  return (
    <ul aria-label="가족별 현황" className="flex flex-col gap-2">
      {families.map((f) => <FamilyBlock key={f.familyId} family={f} actions={actions} />)}
    </ul>
  )
}

/** 가족 한 블록: 구매자 이름들 · "N장 중 M장 사용" · 남음·금액 · 1장 대신 사용 · 발급 줄 · 사용 줄 */
function FamilyBlock({ family, actions }: { family: FamilyGroup; actions: Actions }) {
  return (
    <li aria-label={family.label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate font-bold" title={family.label}>{family.label}</h2>
        <span className="shrink-0 text-sm">{family.issued}장 중 {family.used}장 사용</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">남음 {family.remaining}장 · {formatWon(family.amount)}</p>
        {/* 교인 폰 없이 담당자가 처리할 때. 산 사람이 없으면(buyerId null — 활성 발급 없음·탈퇴·가족 이동) 누구 몫인지 정할 수 없어 잠근다. */}
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '1장 대신 사용'}
          context={family.label}
          message={`${family.label} 가족의 식권 1장을 담당자가 대신 사용 처리할까요?`}
          confirmLabel="사용 처리"
          onConfirm={() => actions.onUseAsAdmin(family)}
          disabled={actions.pending || family.remaining < 1 || family.buyerId === null}
        />
      </div>
      {family.buyerId === null && family.remaining > 0 && (
        <p className="text-xs text-gray-500">대신 사용 처리할 구매자가 없어요 (탈퇴했거나 가족을 옮겼어요)</p>
      )}
      <ul aria-label="발급·사용 내역" className="mt-2 flex flex-col gap-2 text-sm">
        {family.issuances.map((i) => <IssuanceLine key={i.id} issuance={i} remaining={family.remaining} actions={actions} />)}
        {family.usages.map((u) => <UsageLine key={u.id} usage={u} actions={actions} />)}
      </ul>
    </li>
  )
}

function IssuanceLine({ issuance: i, remaining, actions }: { issuance: MealIssuance; remaining: number; actions: Actions }) {
  const buyer = i.buyer || NO_NAME
  // 발급 단위 취소라, 이 발급 장수가 가족 남은 장수보다 많으면 DB 가 would_go_negative 로 거부한다 → 미리 잠그고 이유를 적는다 (설계 §9)
  const blocked = !i.cancelled && i.quantity > remaining
  return (
    <li className={`flex items-start justify-between gap-2 ${i.cancelled ? 'text-gray-500' : ''}`}>
      <div className="min-w-0 break-words">
        <div className={i.cancelled ? 'line-through' : ''}>발급 {i.quantity}장 · {buyer} · {formatWon(i.amount)}</div>
        <div className="text-xs text-gray-500">{formatDateTime(i.issuedAt)} · {i.issuer}{i.memo ? ` · ${i.memo}` : ''}</div>
        {i.cancelled && <div className="text-xs font-bold">취소됨{i.cancelReason ? ` · ${i.cancelReason}` : ''}</div>}
        {blocked && <div className="text-xs text-gray-500">남은 장수({remaining})보다 많아 취소할 수 없어요 — 먼저 사용을 무효 처리해 주세요</div>}
      </div>
      {!i.cancelled && (
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '발급 취소'}
          context={`${formatDateTime(i.issuedAt)} ${buyer} ${i.quantity}장`}
          message={`${buyer} 님의 ${i.quantity}장 발급을 취소할까요? 가족 잔량이 ${i.quantity}장 줄어요.`}
          confirmLabel="취소하기"
          onConfirm={() => actions.onCancel(i)}
          disabled={actions.pending || blocked}
        />
      )}
    </li>
  )
}

function UsageLine({ usage: u, actions }: { usage: MealUsage; actions: Actions }) {
  // admin 이면 person 은 "누구 몫으로", self 면 "어느 폰에서". 이름이 가려졌으면(탈퇴) 자리를 비우지 않는다.
  const who = usageWho(u)
  const when = formatDateTime(u.usedAt)
  return (
    <li className={`flex items-start justify-between gap-2 ${u.voided ? 'text-gray-500' : ''}`}>
      <div className="min-w-0 break-words">
        <div className={u.voided ? 'line-through' : ''}>사용 1장 · {who}</div>
        <div className="text-xs text-gray-500">{when}</div>
        {u.voided && <div className="text-xs font-bold">무효</div>}
      </div>
      {!u.voided && (
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '무효'}
          context={`${who} ${when} 사용`}
          message="이 사용 기록을 무효 처리할까요? 가족 잔량이 1장 늘어요."
          confirmLabel="무효 처리"
          onConfirm={() => actions.onVoid(u)}
          disabled={actions.pending}
        />
      )}
    </li>
  )
}
