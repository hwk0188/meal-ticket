import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { DecoratedPerson } from '../../features/admin/peopleFilter'
import type { MonthLedger } from '../../features/admin/useMonthLedger'
import { StatsPage } from './StatsPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; refetch: () => void }
const { useMonthLedger, useAllPeople, canShareCsv, downloadCsv, shareCsv } = vi.hoisted(() => ({
  useMonthLedger: vi.fn<(month: string) => Q<MonthLedger>>(),
  useAllPeople: vi.fn<() => Q<DecoratedPerson[]>>(),
  canShareCsv: vi.fn<() => boolean>(),
  downloadCsv: vi.fn<(name: string, text: string) => void>(),
  shareCsv: vi.fn<(name: string, text: string) => Promise<void>>(),
}))
vi.mock('../../features/admin/useMonthLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMonthLedger')>()),
  useMonthLedger,
}))
vi.mock('../../features/admin/useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useAllPeople')>()),
  useAllPeople,
}))
vi.mock('../../features/admin/shareCsv', () => ({ canShareCsv, downloadCsv, shareCsv, CSV_TYPE: 'text/csv;charset=utf-8' }))
vi.mock('../../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dates')>()),
  // 화면이 "이번 달" 을 고르는 기준을 고정한다
  todaySeoul: () => '2026-10-13',
}))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11' }
const other = { id: 'm2', title: '수요 저녁', served_on: '2026-10-07' }
const ledger: MonthLedger = {
  issuances: [
    {
      id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인', issued_at: '2026-10-09T05:00:00Z',
      cancelled_at: null, cancel_reason: null, meal, buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null,
    },
    {
      id: 'i2', family_id: 'f2', quantity: 1, unit_price: 5000, memo: null, issued_at: '2026-10-06T05:00:00Z',
      cancelled_at: null, cancel_reason: null, meal: other, buyer: { name: '이영희' }, issuer: { name: '권사' }, canceller: null,
    },
  ],
  usages: [
    {
      id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
      meal, person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null,
    },
  ],
  truncated: false,
}
const people = [
  { id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member', is_minor: false, guardian_id: null, created_at: '', familySize: 1, tags: [], familyHint: null },
  { id: 'p2', family_id: 'f2', name: '이영희', phone: '01098765432', auth_user_id: 'u2', role: 'member', is_minor: false, guardian_id: null, created_at: '', familySize: 1, tags: [], familyHint: null },
] as unknown as DecoratedPerson[]

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/stats']}>
      <Routes>
        <Route path="/admin/stats" element={<StatsPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  useMonthLedger.mockReturnValue({ status: 'success', data: ledger, refetch: vi.fn<() => void>() })
  useAllPeople.mockReturnValue({ status: 'success', data: people, refetch: vi.fn<() => void>() })
  canShareCsv.mockReturnValue(false)
})

describe('StatsPage', () => {
  it('이번 달을 기본으로 열고 합계와 식사별 행을 보여 준다', () => {
    renderPage()
    expect(useMonthLedger).toHaveBeenCalledWith('2026-10')
    expect(screen.getByText('2026년 10월')).toBeInTheDocument()
    const totals = screen.getByRole('status', { name: '이 달 합계' })
    expect(totals).toHaveTextContent('발급 3장')
    expect(totals).toHaveTextContent('사용 1장')
    expect(totals).toHaveTextContent('15,000원')
    const meals = within(screen.getByRole('list', { name: '식사별 합계' })).getAllByRole('listitem')
    expect(meals).toHaveLength(2)
    expect(meals[0]).toHaveTextContent('주일 점심')
    expect(meals[0]).toHaveTextContent('발급 2장')
    expect(meals[1]).toHaveTextContent('수요 저녁')
  })

  it('◀ ▶ 로 달을 옮긴다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '이전 달' }))
    expect(screen.getByText('2026년 9월')).toBeInTheDocument()
    expect(useMonthLedger).toHaveBeenLastCalledWith('2026-09')
    await userEvent.click(screen.getByRole('button', { name: '다음 달' }))
    await userEvent.click(screen.getByRole('button', { name: '다음 달' }))
    expect(screen.getByText('2026년 11월')).toBeInTheDocument()
  })

  it('이름으로 찾으면 그 사람의 장부 줄과 소계가 나온다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '영희')
    expect(screen.queryByRole('list', { name: '식사별 합계' })).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: '찾은 장부' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('발급 1장')
    expect(rows[0]).toHaveTextContent('수요 저녁')
    expect(screen.getByRole('status', { name: '찾은 합계' })).toHaveTextContent('5,000원')
  })

  it('찾는 이름이 없으면 그렇게 말한다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '없는사람')
    expect(screen.getByText('그 이름으로 찾은 기록이 없어요')).toBeInTheDocument()
  })

  it('기록이 없는 달은 빈 상태를 보여 주고 CSV 버튼을 잠근다', () => {
    useMonthLedger.mockReturnValue({ status: 'success', data: { issuances: [], usages: [], truncated: false }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('이 달에는 발급·사용 기록이 없어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 달 CSV 저장' })).toBeDisabled()
  })

  it('CSV 저장은 그 달 전체를 내보낸다 (이름 검색과 무관하다)', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '영희')
    await userEvent.click(screen.getByRole('button', { name: '이 달 CSV 저장' }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [name, text] = downloadCsv.mock.calls[0]!
    expect(name).toBe('식권-2026-10.csv')
    expect(text).toContain('김철수')
    expect(text).toContain('이영희')
  })

  it('공유가 안 되는 브라우저에서는 공유 버튼을 아예 그리지 않는다 (설계 §8.3)', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: '카톡으로 공유' })).not.toBeInTheDocument()
  })

  it('공유가 되면 버튼이 보이고 같은 CSV 를 넘긴다', async () => {
    canShareCsv.mockReturnValue(true)
    shareCsv.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카톡으로 공유' }))
    expect(shareCsv).toHaveBeenCalledWith('식권-2026-10.csv', expect.stringContaining('김철수'))
  })

  it('공유가 실패하면 문구를 띄운다', async () => {
    canShareCsv.mockReturnValue(true)
    shareCsv.mockRejectedValue(new Error('boom'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카톡으로 공유' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('공유하지 못했어요')
  })

  it('천장에 닿으면 일부만 보여 준다고 알린다', () => {
    useMonthLedger.mockReturnValue({ status: 'success', data: { ...ledger, truncated: true }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('기록이 너무 많아 일부만 보여요. 월을 나눠 확인해 주세요.')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useMonthLedger.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { unmount } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    unmount()
    const refetch = vi.fn<() => void>()
    useMonthLedger.mockReturnValue({ status: 'error', refetch })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다 (data 로 분기)', () => {
    useMonthLedger.mockReturnValue({ status: 'error', data: ledger, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 기록을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '식사별 합계' })).toBeInTheDocument()
  })

  it('명단을 못 읽어도 합계는 보여 준다 — 가족 대표만 빈 칸이 된다', () => {
    useAllPeople.mockReturnValue({ status: 'error', refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByRole('status', { name: '이 달 합계' })).toHaveTextContent('발급 3장')
  })
})
