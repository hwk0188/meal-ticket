import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { LedgerEntry } from '../features/history/mergeLedger'
import { HistoryPage } from './HistoryPage'

const { useFamilyLedger } = vi.hoisted(() => ({
  useFamilyLedger: vi.fn<() => { status: 'pending' | 'error' | 'success'; data?: LedgerEntry[]; refetch: () => void }>(),
}))
vi.mock('../features/history/useFamilyLedger', () => ({ useFamilyLedger }))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson: () => ({ id: 'p1', family_id: 'f1', name: '김철수' }) }))

const entries: LedgerEntry[] = [
  { kind: 'usage', id: 'u1', at: '2026-10-12T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '서연', via: 'self', voided: false },
  { kind: 'usage', id: 'u2', at: '2026-10-12T03:30:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '', via: 'admin', voided: true },
  { kind: 'issuance', id: 'i1', at: '2026-10-08T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', quantity: 4, amount: 20000, buyer: '김철수', issuer: '권사', memo: '입금 확인', cancelled: false, cancelReason: null },
  { kind: 'issuance', id: 'i2', at: '2026-10-01T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-05', quantity: 1, amount: 0, buyer: '김철수', issuer: '관리자', memo: '9/28 이월', cancelled: true, cancelReason: null },
]

describe('HistoryPage', () => {
  it('발급과 사용을 시간 역순으로 보여 준다', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: entries, refetch: () => {} })
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

  it('이름이 안 보이는 셀프 사용은 "가족 폰"', () => {
    useFamilyLedger.mockReturnValue({
      status: 'success',
      data: [{ kind: 'usage', id: 'u3', at: '2026-10-12T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '', via: 'self', voided: false }],
      refetch: () => {},
    })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('listitem')).toHaveTextContent('사용 1장 · 가족 폰')
  })

  it('비어 있으면 안내', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: [], refetch: () => {} })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByText('아직 내역이 없어요')).toBeInTheDocument()
  })

  it('불러오는 중', () => {
    useFamilyLedger.mockReturnValue({ status: 'pending', refetch: () => {} })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('데이터 없이 실패하면 alert · "다시 시도" 버튼 — 누르면 refetch 를 부른다', async () => {
    const refetch = vi.fn<() => void>()
    useFamilyLedger.mockReturnValue({ status: 'error', refetch })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('내역을 불러오지 못했어요')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('데이터가 있는 채로 실패하면 목록은 그대로, 조용한 안내만 보여 준다 (경보 아님)', () => {
    useFamilyLedger.mockReturnValue({ status: 'error', data: entries, refetch: () => {} })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('최신 내역을 받지 못했어요')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })
})
