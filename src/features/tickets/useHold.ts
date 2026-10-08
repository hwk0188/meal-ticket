import { useCallback, useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react'

/** 식권 한 장을 사용 처리하는 데 필요한 누름 시간 (설계 §8.2) */
export const HOLD_MS = 600

type Options = { onComplete: () => void; disabled?: boolean; duration?: number }

/**
 * 꾹 누르기. 손가락이 duration 동안 머물면 onComplete 를 한 번 부르고, 그 전에 떼거나(up) 벗어나거나(leave)
 * 스크롤 등으로 끊기면(cancel) 아무 일도 없다. 짧은 탭·실수로 스친 손가락이 식권을 쓰지 못하게 하는 장치다.
 * 채워지는 색은 CSS 전환으로 그리고(holding 플래그), 완료 판정은 타이머가 한다.
 */
export function useHold({ onComplete, disabled = false, duration = HOLD_MS }: Options) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 콜백이 바뀌어도 진행 중인 누름은 최신 콜백을 부른다
  const latest = useRef(onComplete)
  useEffect(() => {
    latest.current = onComplete
  }, [onComplete])

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setHolding(false)
  }, [])

  const start = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (disabled || timer.current !== null) return
      // 마우스 오른쪽·가운데 버튼은 무시. 터치·펜은 button 0 (jsdom 의 generic Event 는 undefined → 통과)
      if (e.button > 0) return
      setHolding(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setHolding(false)
        latest.current()
      }, duration)
    },
    [disabled, duration],
  )

  // disabled 로 바뀌는 순간(처리 중, 잔량 0, 오프라인) 진행 중인 누름을 끊는다. 비활성화된 버튼은 pointerup 을
  // 전달하지 않을 수 있어, 여기서 타이머를 치우지 않으면 손을 뗀 뒤에도 완료 콜백이 뒤늦게 불릴 수 있다.
  // (외부 조건 → 내부 상태 리셋은 effect 의 정당한 용도라 규칙을 이 줄만 해제한다.)
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (disabled) cancel()
  }, [disabled, cancel])

  // 언마운트되면 타이머를 치운다.
  useEffect(() => cancel, [cancel])

  return {
    holding,
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // 길게 누르면 모바일 브라우저가 컨텍스트 메뉴·텍스트 선택을 띄운다. 막는다.
      onContextMenu: (e: SyntheticEvent) => e.preventDefault(),
    },
  }
}
