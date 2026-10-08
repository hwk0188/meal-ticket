import { useState } from 'react'

type Props = {
  label: string
  /** 있으면 한 번 더 묻는다. 없으면 바로 onConfirm. */
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
}

/**
 * 되돌리기 어려운 동작(가족 나가기·자녀 삭제·탈퇴·아이 계정 로그아웃) 앞에 한 번 더 묻는 작은 글자 버튼.
 * window.confirm 은 iOS 홈 화면 앱에서 어색하고 테스트하기 어려워 화면 안에서 묻는다.
 */
export function ConfirmButton({ label, message, confirmLabel = '확인', onConfirm, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const base = 'px-3 py-2 text-xs underline disabled:cursor-not-allowed disabled:opacity-40'
  if (!message || !open) {
    return (
      <button type="button" disabled={disabled} onClick={() => (message ? setOpen(true) : onConfirm())} className={`${base} text-gray-600`}>
        {label}
      </button>
    )
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col items-end gap-1">
      <p role="status" className="text-right text-xs text-gray-700">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(false)
            onConfirm()
          }}
          className={`${base} font-bold text-red-600`}
        >
          {confirmLabel}
        </button>
        <button type="button" disabled={disabled} onClick={() => setOpen(false)} className={`${base} text-gray-600`}>
          취소
        </button>
      </div>
    </div>
  )
}
