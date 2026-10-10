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
// editing·onStart 를 그대로 드러내는 가짜 패널 — 페이지가 두 패널에 신호를 제대로 넘기는지 확인한다.
vi.mock('../../features/admin/PersonMergePanel', () => ({
  PersonMergePanel: ({ editing, onStart }: { editing?: boolean; onStart?: () => void }) => (
    <div>
      <p>합치기 패널{editing ? ' (편집 중)' : ''}</p>
      <button type="button" onClick={() => onStart?.()}>합치기 시작</button>
    </div>
  ),
}))
vi.mock('../../features/admin/PersonDangerZone', () => ({
  PersonDangerZone: ({ editing, onStart }: { editing?: boolean; onStart?: () => void }) => (
    <div>
      <p>위험 구역{editing ? ' (편집 중)' : ''}</p>
      <button type="button" onClick={() => onStart?.()}>위험 시작</button>
    </div>
  ),
}))

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
    // 머리말과 가족 줄 양쪽에 같은 번호가 나온다 (가족 줄은 본인도 다른 식구와 같은 모양으로 둔다).
    expect(screen.getAllByText('010-1234-5678')).toHaveLength(2)
    const family = within(screen.getByRole('list', { name: '가족 구성원' })).getAllByRole('listitem')
    expect(family).toHaveLength(2)
    expect(family[0]).toHaveTextContent('김철수')
    expect(family[0]).toHaveTextContent('본인')
    expect(family[0]).toHaveTextContent('010-1234-5678')
    expect(family[1]).toHaveTextContent('서연')
    expect(family[1]).toHaveTextContent('자녀')
    expect(family[1]).toHaveTextContent('번호 없음')
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

  it('"수정" 폼의 "폼취소" 를 누르면 폼이 닫히고 안내는 그대로다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    await userEvent.click(screen.getByRole('button', { name: '폼취소' }))
    expect(screen.queryByText('정보 수정 폼')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument()
  })

  it('합치기 패널과 위험 구역이 있다', () => {
    renderPage()
    expect(screen.getByText('합치기 패널')).toBeInTheDocument()
    expect(screen.getByText('위험 구역')).toBeInTheDocument()
  })

  it('"수정" 을 누르면 두 패널에 편집 신호(editing)가 전달된다', async () => {
    renderPage()
    expect(screen.getByText('합치기 패널')).toBeInTheDocument() // editing=false 일 때는 꼬리표가 없다
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByText('합치기 패널 (편집 중)')).toBeInTheDocument()
    expect(screen.getByText('위험 구역 (편집 중)')).toBeInTheDocument()
  })

  it('패널에서 onStart 가 오면 지난 성공 알림을 지운다 (성공 알림 위에 무관한 패널 오류가 남지 않게)', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    await userEvent.click(screen.getByRole('button', { name: '폼저장' }))
    expect(screen.getByText('김철수 님 정보를 저장했어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '합치기 시작' }))
    expect(screen.queryByText('김철수 님 정보를 저장했어요')).not.toBeInTheDocument()
  })

  it('알림이 뜬 채 "수정" 을 다시 열면 지난 알림이 바로 지워진다 (패널 쪽 onStart 와 무관하게)', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    await userEvent.click(screen.getByRole('button', { name: '폼저장' }))
    expect(screen.getByText('김철수 님 정보를 저장했어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.queryByText('김철수 님 정보를 저장했어요')).not.toBeInTheDocument()
  })

  it('미성년자는 합치기 패널·위험 구역을 숨긴다 (서버만 막는 동작이라 힌트를 먼저 준다)', () => {
    usePersonDetail.mockReturnValue({ status: 'success', data: { ...detail, person: { ...person, is_minor: true } }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.queryByText('합치기 패널')).not.toBeInTheDocument()
    expect(screen.queryByText('위험 구역')).not.toBeInTheDocument()
  })

  it('이력이 없으면 안내', () => {
    usePersonLedger.mockReturnValue({ status: 'success', data: [], refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('아직 발급·사용 기록이 없어요')).toBeInTheDocument()
  })

  it('이력을 못 불러오면(실패) 안내, 불러오는 중이면 스피너', () => {
    usePersonLedger.mockReturnValue({ status: 'error', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('이력을 받지 못했어요')).toBeInTheDocument()
    usePersonLedger.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    rerender(page())
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
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

  it('초기화된 사람의 머리말은 "미가입" 이 아니라 "초기화됨" 이다 (auth_user_id 가 없어도)', () => {
    usePersonDetail.mockReturnValue({
      status: 'success',
      data: { person: { ...person, phone: null, auth_user_id: null, deleted_at: '2026-10-11T00:00:00Z' }, family: [] },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    const intro = screen.getByText(/초기화됨/)
    expect(intro).toHaveTextContent('초기화됨')
    expect(intro).not.toHaveTextContent('미가입')
  })

  it('머리말에 관리자·자녀 태그가 보이고, 자녀는 계정이 없어도 "미가입" 이 아니다', () => {
    usePersonDetail.mockReturnValue({
      status: 'success',
      data: { person: { ...person, role: 'admin', is_minor: true, auth_user_id: null }, family: [] },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    const intro = screen.getByText(/010-1234-5678/)
    expect(intro).toHaveTextContent('관리자')
    expect(intro).toHaveTextContent('자녀')
    expect(intro).not.toHaveTextContent('미가입')
  })

  it('계정 없는 비자녀 어른은 머리말에 "미가입" 이 보인다', () => {
    usePersonDetail.mockReturnValue({
      status: 'success',
      data: { person: { ...person, role: 'member', is_minor: false, auth_user_id: null }, family: [] },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    expect(screen.getByText(/010-1234-5678/)).toHaveTextContent('미가입')
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

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다 (data 로 분기)', () => {
    usePersonDetail.mockReturnValue({ status: 'error', data: detail, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 정보를 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '가족 구성원' })).toBeInTheDocument()
  })
})
