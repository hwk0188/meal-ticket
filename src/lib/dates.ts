// 모든 날짜 판정은 Asia/Seoul (설계 §2). 폰의 시간대가 달라도 식사일·사용 시각이 흔들리지 않게 한다.
const SEOUL = 'Asia/Seoul'

// en-CA 로케일은 YYYY-MM-DD 로 찍는다. DB 의 served_on(date) 과 같은 모양이라 문자열로 비교할 수 있다.
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit' })
const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const hms = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** 서울 기준 오늘 (YYYY-MM-DD) */
export function todaySeoul(now: Date = new Date()): string {
  return ymd.format(now)
}

const WEEKDAYS = ['주일', '월', '화', '수', '목', '금', '토'] as const

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' → [년, 월, 일]. 날짜만 있는 값은 Date 로 바꾸면 시간대에 밀리므로 직접 쪼갠다. */
function parts(ymdText: string): [number, number, number] {
  const match = YMD_RE.exec(ymdText)
  if (!match) throw new Error(`parts: 'YYYY-MM-DD' 형식이 아닙니다 (${ymdText})`)
  const [, y, m, d] = match
  return [Number(y), Number(m), Number(d)]
}

function dayOfWeek(ymdText: string): number {
  const [y, m, d] = parts(ymdText)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** '2026-10-11' → '10월 11일 (주일)' */
export function formatMealDate(servedOn: string): string {
  const [, m, d] = parts(servedOn)
  return `${m}월 ${d}일 (${WEEKDAYS[dayOfWeek(servedOn)]})`
}

/** '2026-10-12' → '10/12' */
export function formatShortDate(servedOn: string): string {
  const [, m, d] = parts(servedOn)
  return `${m}/${d}`
}

/** ISO 시각 → 서울 'HH:MM' */
export function formatTime(iso: string): string {
  return hm.format(new Date(iso))
}

/** ISO 시각 → 서울 'M/D' (동의 날짜처럼 날짜만 보여 줄 때) */
export function formatDate(iso: string): string {
  return formatShortDate(todaySeoul(new Date(iso)))
}

/** ISO 시각 → 서울 'M/D HH:MM' */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`
}

/** 초 단위 시계 'HH:MM:SS' (홈 화면 실시간 시계 — 스크린샷 판별용) */
export function formatClock(now: Date): string {
  return hms.format(now)
}

/**
 * 기준일 "다음" 의 첫 일요일. DB `create_next_sunday_lunch` 와 같은 규칙이라 버튼에 미리 날짜를 보여 줄 수 있다.
 * 일→+7, 월→+6, …, 토→+1
 */
export function nextSundayAfter(base: string): string {
  const [y, m, d] = parts(base)
  const dow = dayOfWeek(base)
  const target = new Date(Date.UTC(y, m - 1, d + ((6 - dow) % 7) + 1))
  return target.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' 에 날수를 더한다 (UTC 산술이라 시간대·서머타임 영향 없음) */
export function addDays(ymdText: string, days: number): string {
  const [y, m, d] = parts(ymdText)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
