import { addDays, nextSundayAfter } from '../../lib/dates'
import type { Meal } from '../tickets/groupTickets'

/** 주일 점심의 고정 제목. DB create_next_sunday_lunch 의 리터럴과 같아야 한다. */
export const SUNDAY_LUNCH_TITLE = '주일 점심'

/** 버튼에 미리 보여 줄 "다음 주일 점심" 날짜. 기준일 = max(가장 늦은 주일 점심, 어제), 그 다음 일요일 (DB 와 같은 규칙). */
export function nextSundayLunchDate(meals: readonly Pick<Meal, 'title' | 'served_on'>[], today: string): string {
  const yesterday = addDays(today, -1)
  const latest = meals.filter((m) => m.title === SUNDAY_LUNCH_TITLE).map((m) => m.served_on).toSorted().at(-1)
  const base = latest && latest > yesterday ? latest : yesterday
  return nextSundayAfter(base)
}
