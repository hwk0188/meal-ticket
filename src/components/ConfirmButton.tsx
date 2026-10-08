import { useEffect, useId, useRef, useState } from 'react'

type Align = 'start' | 'center' | 'end'

type Props = {
  label: string
  /** 있으면 한 번 더 묻는다. 없으면 바로 onConfirm. */
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  /** 프롬프트가 열렸을 때의 정렬. 목록 행·프로필 영역은 끝(기본), 바닥글처럼 가운데 둘 곳은 'center'. */
  align?: Align
}

const ALIGN_CLASSES: Record<Align, string> = {
  start: 'items-start text-left',
  center: 'items-center text-center',
  end: 'items-end text-right',
}

/**
 * 되돌리기 어려운 동작(가족 나가기·자녀 삭제·탈퇴·아이 계정 로그아웃) 앞에 한 번 더 묻는 작은 글자 버튼.
 * window.confirm 은 iOS 홈 화면 앱에서 어색하고 테스트하기 어려워 화면 안에서 묻는다.
 */
export function ConfirmButton({ label, message, confirmLabel = '확인', onConfirm, disabled = false, align = 'end' }: Props) {
  const [open, setOpen] = useState(false)
  // disabled 로 바뀌는 순간 열려 있던 프롬프트를 닫는다 (effect 없이 렌더 중 상태를 맞추는 React 의 표준 패턴).
  const [prevDisabled, setPrevDisabled] = useState(disabled)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 프롬프트가 닫히는 모든 경로(취소·확인·강제 닫힘)에서 true 로 두고,
  // 닫힌 뒤 같은 effect 에서 트리거 버튼으로 포커스를 되돌린다 (비활성 버튼에 focus() 를 걸어도 아무 일도 없다).
  const [pendingFocus, setPendingFocus] = useState(false)

  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled)
    if (disabled) {
      setPendingFocus(true)
      setOpen(false)
    }
  }

  const messageId = useId()

  useEffect(() => {
    // open 이 닫힐 때마다(의존성이 바뀔 때마다) 한 번만 실행된다. pendingFocus 를 다시 false 로
    // 되돌리지 않아도 된다 — 다음 번 닫힘은 항상 open 의존성 변화를 동반하기 때문이다.
    if (open) {
      cancelRef.current?.focus()
    } else if (pendingFocus) {
      triggerRef.current?.focus()
    }
  }, [open, pendingFocus])

  const base = 'px-3 text-xs underline disabled:cursor-not-allowed disabled:opacity-40'

  if (!message || !open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (message ? setOpen(true) : onConfirm())}
        className={`${base} py-2 text-gray-600`}
      >
        {label}
      </button>
    )
  }

  return (
    <div role="group" aria-label={label} className={`flex flex-col gap-1 ${ALIGN_CLASSES[align]}`}>
      <p id={messageId} role="status" className="text-xs text-gray-700">{message}</p>
      <div className="flex gap-2">
        {/* 되돌릴 수 없는 쪽보다 그만두는 쪽을 먼저 둔다 (iOS·Material 의 관행). */}
        <button
          ref={cancelRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setPendingFocus(true)
            setOpen(false)
          }}
          className={`${base} py-3 text-gray-600`}
        >
          취소
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-describedby={messageId}
          onClick={() => {
            setPendingFocus(true)
            setOpen(false)
            onConfirm()
          }}
          className={`${base} py-3 font-bold text-red-600`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
