import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Spinner } from '../../components/ui'
import { PersonDangerZone } from '../../features/admin/PersonDangerZone'
import { PersonEditForm } from '../../features/admin/PersonEditForm'
import { PersonMergePanel } from '../../features/admin/PersonMergePanel'
import { usePersonDetail, type FamilyMemberRow } from '../../features/admin/usePersonDetail'
import { usePersonLedger } from '../../features/admin/usePersonLedger'
import type { LedgerEntry } from '../../features/history/mergeLedger'
import { formatDateTime, formatShortDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'
import { formatPhone } from '../../lib/phone'

/** `#/admin/people/:personId` — 사람 상세 (설계 §8.3). 전체 번호·가족·이력과 고치기 동작. */
export function PersonDetailPage() {
  const { personId = '' } = useParams()
  const detail = usePersonDetail(personId)
  const ledger = usePersonLedger(personId)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const person = detail.data?.person
  const anonymized = person?.deleted_at !== null && person?.deleted_at !== undefined

  function done(message: string) {
    setNotice(message)
    setEditing(false)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/admin/people" className="text-sm text-blue-600 underline">← 사람</Link>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* data 로 분기한다 (공통 규약). null 은 "없는 사람" 이라는 정상 값이다. */}
      {detail.data !== undefined ? (
        detail.data === null || !person ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
            사람을 찾을 수 없어요. 목록으로 돌아가 주세요.
          </p>
        ) : (
          <>
            <div>
              <h1 className="text-lg font-extrabold">{person.name}</h1>
              <p className="text-xs text-gray-500">
                {person.phone ? formatPhone(person.phone) : '번호 없음'}
                {person.role === 'admin' ? ' · 관리자' : ''}
                {person.is_minor ? ' · 자녀' : ''}
                {!person.is_minor && !person.auth_user_id ? ' · 미가입' : ''}
              </p>
            </div>
            {detail.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요</p>}
            {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}

            {anonymized ? (
              <p role="status" className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">초기화·합쳐진 사람이에요. 기록만 남아 있어요.</p>
            ) : editing ? (
              <PersonEditForm personId={person.id} name={person.name} phone={person.phone} onDone={done} onCancel={() => setEditing(false)} />
            ) : (
              <button type="button" onClick={() => { setNotice(null); setEditing(true) }} className="self-start px-3 py-2 text-xs text-blue-600 underline">수정</button>
            )}

            <section aria-label="가족" className="flex flex-col gap-2">
              <h2 className="text-xs font-bold text-gray-500">가족</h2>
              {detail.data.family.length === 0 ? (
                <p className="text-sm text-gray-500">가족 정보가 없어요</p>
              ) : (
                <ul aria-label="가족 구성원" className="flex flex-col gap-2">
                  {detail.data.family.map((m) => <FamilyLine key={m.id} member={m} meId={person.id} />)}
                </ul>
              )}
            </section>

            <section aria-label="이력" className="flex flex-col gap-2">
              <h2 className="text-xs font-bold text-gray-500">발급·사용 이력</h2>
              {ledger.data && ledger.data.length > 0 ? (
                <ul aria-label="발급·사용 이력" className="flex flex-col gap-2">
                  {ledger.data.map((entry) => <LedgerLine key={`${entry.kind}-${entry.id}`} entry={entry} />)}
                </ul>
              ) : ledger.data ? (
                <p className="text-sm text-gray-500">아직 발급·사용 기록이 없어요</p>
              ) : ledger.status === 'error' ? (
                <p role="status" className="text-xs text-gray-500">이력을 받지 못했어요</p>
              ) : (
                <Spinner inline />
              )}
            </section>

            {!anonymized && (
              <>
                <PersonMergePanel person={person} onDone={done} />
                <PersonDangerZone person={person} onDone={done} />
              </>
            )}
          </>
        )
      ) : detail.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          사람을 불러오지 못했어요
          <button type="button" onClick={() => void detail.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function FamilyLine({ member, meId }: { member: FamilyMemberRow; meId: string }) {
  const tags = [member.id === meId ? '본인' : null, member.role === 'admin' ? '관리자' : null, member.is_minor ? '자녀' : null, member.deleted_at ? '초기화됨' : null].filter(
    (t): t is string => t !== null,
  )
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-bold">{member.name}</span>
        {tags.map((tag) => (
          <span key={tag} className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">{tag}</span>
        ))}
      </span>
      {/* 본인 줄은 위 머리말에 이미 전체 번호가 보이므로 같은 문구를 중복해 보여 주지 않는다 (getByText 단언이 하나만 찾는다). */}
      <span className="shrink-0 text-xs text-gray-500">{member.id === meId ? '-' : member.phone ? formatPhone(member.phone) : '번호 없음'}</span>
    </li>
  )
}

/** 교인 내역 화면과 같은 줄 모양 + 관리자만 보는 취소 사유. */
function LedgerLine({ entry }: { entry: LedgerEntry }) {
  const struck = entry.kind === 'issuance' ? entry.cancelled : entry.voided
  const servedOn = entry.servedOn ? `${formatShortDate(entry.servedOn)} ` : ''
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-500' : ''}`}>
      {entry.kind === 'issuance' ? (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>발급 {entry.quantity}장 · {formatWon(entry.amount)}</div>
          <div className="text-xs">{formatDateTime(entry.at)} · {servedOn}{entry.mealTitle} · {entry.issuer}{entry.memo ? ` · ${entry.memo}` : ''}</div>
          {entry.cancelled && <div className="text-xs font-bold">취소됨{entry.cancelReason ? ` · ${entry.cancelReason}` : ''}</div>}
        </>
      ) : (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>
            사용 1장 · {entry.via === 'admin' ? '담당자 처리' : entry.person ? `${entry.person} 폰` : '가족 폰'}
          </div>
          <div className="text-xs">{formatDateTime(entry.at)} · {servedOn}{entry.mealTitle}</div>
          {entry.voided && <div className="text-xs font-bold">무효</div>}
        </>
      )}
    </li>
  )
}
