import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { LedgerEntry } from '../features/history/mergeLedger'
import { HistoryPage } from './HistoryPage'

const { useFamilyLedger } = vi.hoisted(() => ({
  useFamilyLedger: vi.fn<() => { status: 'pending' | 'error' | 'success'; data?: LedgerEntry[] }>(),
}))
vi.mock('../features/history/useFamilyLedger', () => ({ useFamilyLedger }))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson: () => ({ id: 'p1', family_id: 'f1', name: '김철수' }) }))

const entries: LedgerEntry[] = [
  { kind: 'usage', id: 'u1', at: '2026-10-12T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '서연', via: 'self', voided: false },
  { kind: 'usage', id: 'u2', at: '2026-10-12T03:30:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '', via: 'admin', voided: true },
  { kind: 'issuance', id: 'i1', at: '2026-10-08T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', quantity: 4, amount: 20000, buyer: '김철수', issuer: '권사', memo: '입금 확인', cancelled: false },
  { kind: 'issuance', id: 'i2', at: '2026-10-01T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-05', quantity: 1, amount: 0, buyer: '김철수', issuer: '관리자', memo: '9/28 이월', cancelled: true },
]

describe('HistoryPage', () => {
  it('발급과 사용을 시간 역순으로 보여 준다', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: entries })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '내역' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('사용 1장 · 서연 폰')
    expect(items[0]).toHaveTextContent('10/12 12:31 · 주일 점심')
    expect(items[1]).toHaveTextContent('담당자 처리')
    expect(items[1]).toHaveTextContent('무효')
    expect(items[2]).toHaveTextContent('발급 4장 · 20,000원')
    expect(items[2]).toHaveTextContent('10/8 10:00 · 10/12 주일 점심 · 권사 · 입금 확인')
    expect(items[3]).toHaveTextContent('취소됨')
  })

  it('비어 있으면 안내', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: [] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByText('아직 내역이 없어요')).toBeInTheDocument()
  })

  it('불러오는 중', () => {
    useFamilyLedger.mockReturnValue({ status: 'pending' })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('데이터 없이 실패하면 alert, 데이터가 있으면 목록을 유지한다', () => {
    useFamilyLedger.mockReturnValue({ status: 'error' })
    const { unmount } = render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('내역을 불러오지 못했어요')
    unmount()
    useFamilyLedger.mockReturnValue({ status: 'error', data: entries })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })
})
