import { useEffect, useState } from 'react'
import { formatClock } from '../../lib/dates'

/** 초 단위 실시간 시계. 스크린샷으로 식권 화면을 흉내 내기 어렵게 한다 (설계 §8.2 부정 사용 대비). */
export function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <time dateTime={now.toISOString()} className="font-mono text-2xl font-bold tabular-nums">
      {formatClock(now)}
    </time>
  )
}
