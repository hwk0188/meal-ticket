import { useEffect, useState } from 'react'

/**
 * 주어진 시각(ms, Date.now() 와 같은 기준)까지 남은 초. 1초마다 줄고 0 에서 멈춘다.
 * (effect 안에서 setState 를 바로 부르지 않는다 — 인터벌 콜백에서만. 만료 시각이 바뀌면 다음 틱에 새 값으로 센다.)
 */
export function useCountdown(expiresAtMs: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAtMs) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAtMs])
  if (!expiresAtMs) return 0
  return Math.max(0, Math.ceil((expiresAtMs - now) / 1000))
}

/** 581 → '9분 41초' */
export function formatRemaining(seconds: number): string {
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}
