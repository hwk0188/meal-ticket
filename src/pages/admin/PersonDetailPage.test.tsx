import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { LedgerEntry } from '../../features/history/mergeLedger'
import type { PersonDetail } from '../../features/admin/usePersonDetail'
import { PersonDetailPage } from './PersonDetailPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; refetch: () => void }
const { usePersonDetail, usePersonLedger } = vi.hoisted(() => ({
  usePersonDetail: vi.fn<(id: string) => Q<PersonDetail | null>>(),
  usePersonLedger: vi.fn<(id: string) => Q<LedgerEntry[]>>(),
}))
vi.mock('../../features/admin/usePersonDetail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/usePersonDetail')>()),
  usePersonDetail,
}))
vi.mock('../../features/admin/usePersonLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/usePersonLedger')>()),
  usePersonLedger,
}))
vi.mock('../../features/admin/PersonEditForm', () => ({
  PersonEditForm: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>정보 수정 폼</p>
      <button type="button" onClick={() => onDone('김철수 님 정보를 저장했어요')}>폼저장</button>
      <button type="button" onClick={onCancel}>폼취소</button>
    </div>
  ),
}))
vi.mock('../../features/admin/PersonMergePanel', () => ({ PersonMergePanel: () => <p>합치기 패널</p> }))
vi.mock('../../features/admin/PersonDangerZone', () => ({ PersonDangerZone: () => <p>위험 구역</p> }))

const PID = '00000000-0000-4000-8000-000000000001'
const person = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
}
const detail: PersonDetail = {
  person,
  family: [
    { id: PID, name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1', role: 'member', deleted_at: null },
    { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k1', role: 'member', deleted_at: null },
  ],
}
const ledger: LedgerEntry[] = [
  { kind: 'usage', id: 'u1', at: '2026-10-11T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-11', person: '김철수', via: 'self', voided: false },
  { kind: 'issuance', id: 'i1', at: '2026-10-09T05:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-11', quantity: 2, amount: 10000, buyer: '김철수', issuer: '권사', memo: '입금 확인', cancelled: true, cancelReason: '입금 취소' },
]

function page(path = `/admin/people/${PID}`) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/people/:personId" element={<PersonDetailPage />} />
        <Route path="/admin/people" element={<p>사람 목록</p>} />
      </Routes>
    </MemoryRouter>
  )
}
const renderPage = (path?: string) => render(page(path))

beforeEach(() => {
  usePersonDetail.mockReturnValue({ status: 'success', data: detail, refetch: vi.fn<() => void>() })
  usePersonLedger.mockReturnValue({ status: 'success', data: ledger, refetch: vi.fn<() => void>() })
})

describe('PersonDetailPage', () => {
  it('이름·전체 번호·가족 구성원·이력을 보여 준다', () => {
    renderPage()
    expect(usePersonDetail).toHaveBeenCalledWith(PID)
    expect(screen.getByRole('heading', { level: 1, name: '김철수' })).toBeInTheDocument()
    expect(screen.getByText('010-1234-5678')).toBeInTheDocument()
    const family = within(screen.getByRole('list', { name: '가족 구성원' })).getAllByRole('listitem')
    expect(family).toHaveLength(2)
    expect(family[1]).toHaveTextContent('서연')
    expect(family[1]).toHaveTextContent('자녀')
    const history = within(screen.getByRole('list', { name: '발급·사용 이력' })).getAllByRole('listitem')
    expect(history[0]).toHaveTextContent('사용 1장 · 김철수 폰')
    expect(history[1]).toHaveTextContent('발급 2장 · 10,000원')
    expect(history[1]).toHaveTextContent('취소됨 · 입금 취소')
  })

  it('"수정" 을 누르면 폼이 열리고, 저장하면 닫히며 안내가 뜬다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByText('정보 수정 폼')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '폼저장' }))
    expect(screen.queryByText('정보 수정 폼')).not.toBeInTheDocument()
    expect(screen.getByText('김철수 님 정보를 저장했어요')).toBeInTheDocument()
  })

  it('합치기 패널과 위험 구역이 있다', () => {
    renderPage()
    expect(screen.getByText('합치기 패널')).toBeInTheDocument()
    expect(screen.getByText('위험 구역')).toBeInTheDocument()
  })

  it('이력이 없으면 안내', () => {
    usePersonLedger.mockReturnValue({ status: 'success', data: [], refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('아직 발급·사용 기록이 없어요')).toBeInTheDocument()
  })

  it('익명화된 사람은 초기화됨 안내와 함께 수정·합치기·위험 구역을 숨긴다', () => {
    usePersonDetail.mockReturnValue({
      status: 'success',
      data: { person: { ...person, name: '탈퇴한 사용자', phone: null, auth_user_id: null, deleted_at: '2026-10-11T00:00:00Z' }, family: [] },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    expect(screen.getByText('초기화·합쳐진 사람이에요. 기록만 남아 있어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByText('합치기 패널')).not.toBeInTheDocument()
    expect(screen.queryByText('위험 구역')).not.toBeInTheDocument()
  })

  it('없는 사람은 안내만', () => {
    usePersonDetail.mockReturnValue({ status: 'success', data: null, refetch: vi.fn<() => void>() })
    renderPage('/admin/people/zzz')
    expect(screen.getByRole('alert')).toHaveTextContent('사람을 찾을 수 없어요')
    expect(screen.queryByRole('list', { name: '가족 구성원' })).not.toBeInTheDocument()
  })

  it('"← 사람" 링크는 목록으로', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: '← 사람' }))
    expect(screen.getByText('사람 목록')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    usePersonDetail.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    usePersonDetail.mockReturnValue({ status: 'error', refetch })
    rerender(page())
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })
})
