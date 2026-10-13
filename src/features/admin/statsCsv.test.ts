import type { StatsRow } from './statsRows'
import { csvFilename, toCsv } from './statsCsv'

const row = (over: Partial<StatsRow> = {}): StatsRow => ({
  kind: '발급', at: '2026-10-09T05:00:00Z', servedOn: '2026-10-11', mealId: 'm1', mealTitle: '주일 점심',
  name: '김철수', familyRep: '김철수', quantity: 2, unitPrice: 5000, amount: 10000, handler: '권사', memo: '입금 확인', ...over,
})

const lines = (text: string) => text.replace(/^﻿/, '').split('\r\n')

describe('toCsv', () => {
  it('BOM 으로 시작한다 (한국어 엑셀이 cp949 로 읽어 한글이 깨지는 것을 막는다)', () => {
    expect(toCsv([])).toMatch(/^﻿/)
  })

  it('머리글 11열, 설계 순서대로', () => {
    expect(lines(toCsv([]))[0]).toBe('종류,일시,식사일,식사명,이름,가족 대표,장수,단가,금액,처리자,메모')
  })

  it('빈 달은 머리글만 (끝에 빈 줄을 남기지 않는다)', () => {
    expect(lines(toCsv([]))).toHaveLength(1)
  })

  it('발급 한 줄 — 금액은 숫자만 (엑셀에서 더할 수 있어야 한다)', () => {
    expect(lines(toCsv([row()]))[1]).toBe('발급,2026-10-09 14:00,2026-10-11,주일 점심,김철수,김철수,2,5000,10000,권사,입금 확인')
  })

  it('사용 행의 단가·금액·메모는 빈 칸', () => {
    const used = row({ kind: '사용', at: '2026-10-11T03:31:00Z', quantity: 1, unitPrice: null, amount: null, memo: null, handler: '김철수' })
    expect(lines(toCsv([used]))[1]).toBe('사용,2026-10-11 12:31,2026-10-11,주일 점심,김철수,김철수,1,,,김철수,')
  })

  it('쉼표·따옴표·줄바꿈이 든 칸은 인용하고 따옴표는 두 개로 늘린다', () => {
    const odd = row({ mealTitle: '점심, 특식', memo: '김"권사"님\n확인' })
    expect(lines(toCsv([odd]))[1]).toContain('"점심, 특식"')
    expect(toCsv([odd])).toContain('"김""권사""님\n확인"')
  })

  it('수식으로 시작하는 칸은 앞에 \' 를 붙인다 (이름은 교인이 직접 적는 값이다)', () => {
    expect(lines(toCsv([row({ name: '=HYPERLINK("http://x")' })]))[1]).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(lines(toCsv([row({ memo: '-1 확인' })]))[1]).toContain(`'-1 확인`)
  })

  it('줄 순서는 받은 순서 그대로 (정렬은 statsRows 가 이미 했다)', () => {
    const text = lines(toCsv([row({ name: '가' }), row({ name: '나' })]))
    expect(text[1]).toContain('가')
    expect(text[2]).toContain('나')
  })
})

describe('csvFilename', () => {
  it('월이 들어간 이름', () => {
    expect(csvFilename('2026-10')).toBe('식권-2026-10.csv')
  })
})
