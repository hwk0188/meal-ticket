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

  // 타이머 콜백이 "완료되는 순간" disabled 였는지 보려고 ref 로 따라간다. (effect 안에서 ref 에 값만
  // 쓰는 것은 안전하다 — oxlint 의 react(refs) 규칙은 렌더 '중' 읽기를 막을 뿐, 이벤트·이펙트에서의
  // 접근은 규칙 설명에서도 허용한다.)
  const disabledRef = useRef(disabled)
  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    setHolding(false)
  }, [clearTimer])

  const start = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (disabled || timer.current !== null) return
      // 마우스 오른쪽·가운데 버튼은 무시. 터치·펜은 button 0 (jsdom 의 generic Event 는 undefined → 통과)
      if (e.button > 0) return
      setHolding(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setHolding(false)
        // 누르는 중 disabled 가 되면(처리 중 등) 완료 콜백은 부르지 않는다 — 눌림 자체는 취소된 것이다.
        if (!disabledRef.current) latest.current()
      }, duration)
    },
    [disabled, duration],
  )

  // 언마운트되면 타이머를 치운다.
  useEffect(() => clearTimer, [clearTimer])

  return {
    // disabled 가 되는 즉시 화면에서는 누른 상태를 보이지 않는다. ref 를 렌더 중에 읽지 않도록
    // props 만으로 계산한다 — 실제 취소(완료 콜백 억제)는 위 disabledRef 가 맡는다.
    holding: holding && !disabled,
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
