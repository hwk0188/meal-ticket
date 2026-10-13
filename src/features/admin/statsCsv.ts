import { formatSeoulStamp } from '../../lib/dates'
import type { StatsRow } from './statsRows'

/** 설계 §8.3 이 정한 11열, 그 순서. */
const HEADER = ['종류', '일시', '식사일', '식사명', '이름', '가족 대표', '장수', '단가', '금액', '처리자', '메모'] as const

// 엑셀이 칸을 수식으로 해석하는 글자들. 이름은 교인이 직접 적는 값이라(20자 제한뿐) 여기로 들어올 수 있다.
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTE = /[",\n\r]/

function cell(value: string | number | null): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? String(value) : value
  if (text === '') return ''
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return NEEDS_QUOTE.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * 통계 행 → CSV 문자열. 줄 순서는 받은 그대로다(정렬은 `statsRows` 가 한다).
 * BOM 은 한국어 엑셀이 cp949 로 읽어 한글이 깨지는 것을 막고, CRLF 는 엑셀·구글 시트가 모두 안전하게 읽는다.
 * 장수·단가·금액은 숫자만 쓴다 — 엑셀에서 더할 수 있어야 한다.
 */
export function toCsv(rows: readonly StatsRow[]): string {
  const body = rows.map((r) =>
    [
      r.kind,
      formatSeoulStamp(r.at),
      r.servedOn,
      r.mealTitle,
      r.name,
      r.familyRep,
      r.quantity,
      r.unitPrice,
      r.amount,
      r.handler,
      r.memo,
    ]
      .map(cell)
      .join(','),
  )
  return `﻿${[HEADER.join(','), ...body].join('\r\n')}`
}

/** '2026-10' → '식권-2026-10.csv' */
export function csvFilename(month: string): string {
  return `식권-${month}.csv`
}
