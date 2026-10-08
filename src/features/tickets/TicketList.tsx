import { useState, type KeyboardEvent } from 'react'
import { buildRows, FOLD_THRESHOLD, type TicketRow } from './buildRows'
import type { Usage } from './groupTickets'
import { HOLD_MS, useHold } from './useHold'
import type { Member } from './useFamilyTickets'

type Props = {
  issued: number
  used: number
  usages: readonly Usage[]
  members: readonly Member[]
  /** 지금 누를 수 있는가 (온라인 · 잔량 있음 · 처리 중 아님) */
  canUse: boolean
  pending: boolean
  onUse: () => void
}

/** 식권 한 장 = 좌우 꽉 찬 가로 막대. 아래로 쌓인다. */
export function TicketList({ issued, used, usages, members, canUse, pending, onUse }: Props) {
  const [expanded, setExpanded] = useState(false)
  const rows = buildRows({ issued, used, usages, members })
  const usedRows = rows.filter((r) => r.state === 'used')
  const openRows = rows.filter((r) => r.state === 'open')
  const fold = usedRows.length >= FOLD_THRESHOLD && !expanded

  return (
    <ul className="flex flex-col gap-2" aria-label="식권 목록">
      {fold ? (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-left text-sm text-gray-500"
          >
            사용 완료 {usedRows.length}장 펼치기
          </button>
        </li>
      ) : (
        usedRows.map((row) => <UsedRow key={row.index} row={row} total={issued} />)
      )}
      {openRows.map((row) => (
        <OpenRow key={row.index} row={row} total={issued} disabled={!canUse || pending} onUse={onUse} />
      ))}
    </ul>
  )
}

function UsedRow({ row, total }: { row: TicketRow; total: number }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-gray-500">
      <span aria-hidden className="text-xl">🎫</span>
      <div className="flex-1">
        <div className="text-sm font-bold">사용 완료</div>
        {row.label && <div className="text-xs">{row.label}</div>}
      </div>
      <span className="text-xs tabular-nums">{row.index} / {total}</span>
    </li>
  )
}

function OpenRow({ row, total, disabled, onUse }: { row: TicketRow; total: number; disabled: boolean; onUse: () => void }) {
  const { holding, handlers } = useHold({ onComplete: onUse, disabled })
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // 키보드·보조기기 사용자는 꾹 누를 수 없으므로 Enter/Space 로 바로 쓴다. 키를 누르고 있으면 브라우저가
    // keydown 을 반복해서 보내는데(auto-repeat), 그대로 두면 한 번 누른 채로 여러 장이 쓰여 버린다.
    if (e.repeat) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) onUse()
    }
  }
  return (
    <li>
      <button
        type="button"
        aria-label={`식권 ${row.index}번 꾹 눌러 사용하기`}
        disabled={disabled}
        onKeyDown={onKeyDown}
        {...handlers}
        className="relative flex w-full touch-pan-y select-none items-center gap-3 overflow-hidden rounded-xl border-2 border-blue-600 bg-white px-4 py-4 text-left [-webkit-touch-callout:none] disabled:border-gray-300 disabled:text-gray-400"
      >
        {/* touch-pan-y: 세로 스크롤(목록이 길 때)은 브라우저가 가져가게 둔다 — 그 드래그는 pointercancel 로
            잡혀 useHold 가 취소하므로(설계대로) 식권이 잘못 쓰이지 않는다. iOS 는 버튼 롱프레스에 contextmenu 를
            내지 않고 콜아웃을 띄우므로 touch-callout 도 끈다. */}
        {/* 왼쪽에서 차오르는 색. HOLD_MS 동안 꽉 차면 useHold 가 onUse 를 부른다 */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-blue-200"
          style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
        />
        <span aria-hidden className="relative text-xl">🎫</span>
        <span className="relative flex-1 text-sm font-bold">{holding ? '누르는 중…' : '식권 1장'}</span>
        <span className="relative text-xs tabular-nums">{row.index} / {total}</span>
      </button>
    </li>
  )
}
