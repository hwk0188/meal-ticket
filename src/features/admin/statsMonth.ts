/**
 * 통계의 월 계산. 월은 `YYYY-MM`, 범위는 식사일(`meals.served_on`, date 열)과 같은 모양인 `YYYY-MM-DD` 다.
 * `lib/dates.ts` 와 같이 UTC 산술만 쓴다 — 날짜만 있는 값을 로컬 Date 로 바꾸면 시간대에 하루씩 밀린다.
 */
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

function parts(month: string): [number, number] {
  const match = MONTH_RE.exec(month)
  if (!match) throw new Error(`statsMonth: 'YYYY-MM' 형식이 아닙니다 (${month})`)
  const [, y, m] = match
  return [Number(y), Number(m)]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** '2026-10-13' → '2026-10'. 입력은 `todaySeoul()` 의 결과다. */
export function currentMonth(today: string): string {
  return today.slice(0, 7)
}

/** '2026-10' → { from: '2026-10-01', to: '2026-10-31' }. `Date.UTC(y, m, 0)` 이 그 달의 마지막 날이다. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = parts(month)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
}

/** '2026-12' + 1 → '2027-01'. 해를 넘는 계산을 월 수로 바꿔서 한다. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(month)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}

/** '2026-01' → '2026년 1월' (앞의 0 을 떼고 읽는다) */
export function formatMonth(month: string): string {
  const [y, m] = parts(month)
  return `${y}년 ${m}월`
}
