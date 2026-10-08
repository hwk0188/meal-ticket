import { formatTime } from '../../lib/dates'
import type { Usage } from './groupTickets'
import type { Member } from './useFamilyTickets'

/** 사용된 장이 이 수 이상이면 "사용 완료 N장" 한 줄로 접는다 (설계 §8.2) */
export const FOLD_THRESHOLD = 3

export type TicketRow = { index: number; state: 'used' | 'open'; label?: string }

type Input = { issued: number; used: number; usages: readonly Usage[]; members: readonly Member[] }

function labelOf(usage: Usage, members: readonly Member[]): string {
  const time = formatTime(usage.used_at)
  if (usage.used_via === 'admin') return `${time} 담당자 처리`
  const name = members.find((m) => m.id === usage.person_id)?.name
  return name ? `${time} 사용 · ${name} 폰` : `${time} 사용`
}

/**
 * 발급 장수만큼 행을 만든다. 앞에서부터 used 장은 '사용 완료'(시각·누른 폰), 나머지는 누를 수 있는 장.
 * usages 는 시각 오름차순이라 i 번째 사용 기록이 i 번째 장에 붙는다. 기록이 아직 덜 읽혔으면 시각 없이 둔다.
 */
export function buildRows({ issued, used, usages, members }: Input): TicketRow[] {
  return Array.from({ length: issued }, (_, i) => {
    if (i < used) {
      const usage = usages[i]
      return { index: i + 1, state: 'used', label: usage ? labelOf(usage, members) : undefined }
    }
    return { index: i + 1, state: 'open', label: undefined }
  })
}
