import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { groupMealLedger, type MealIssuanceRow, type MealUsageRow } from '../../features/admin/groupMealLedger'
import type { MealDetail } from '../../features/admin/useMealDetail'
import { MealDetailPage } from './MealDetailPage'

type Q = { status: 'pending' | 'error' | 'success'; data?: MealDetail | null; refetch: () => void }
const { useMealDetail } = vi.hoisted(() => ({ useMealDetail: vi.fn<(mealId: string) => Q>() }))
vi.mock('../../features/admin/useMealDetail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMealDetail')>()),
  useMealDetail,
}))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '' }
const issuance = (over: Partial<MealIssuanceRow>): MealIssuanceRow => ({
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null, issued_at: '2026-10-09T05:00:00Z',
  cancelled_at: null, cancel_reason: null, buyer: { name: '김철수', deleted_at: null, family_id: 'f1' }, issuer: { name: '권사' }, ...over,
})
const usage = (over: Partial<MealUsageRow>): MealUsageRow => ({
  id: 'u1', person_id: 'p2', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null, person: { name: '서연', deleted_at: null, family_id: 'f1' }, ...over,
})
const ledger = groupMealLedger(
  [
    issuance({ id: 'i1' }),
    issuance({ id: 'i2', person_id: 'p3', buyer: { name: '이영희', deleted_at: null, family_id: 'f1' }, quantity: 1, issued_at: '2026-10-10T05:00:00Z', memo: '입금 확인' }),
    issuance({ id: 'i3', quantity: 1, issued_at: '2026-10-08T05:00:00Z', cancelled_at: '2026-10-08T06:00:00Z', cancel_reason: '실수' }),
    issuance({ id: 'i4', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수', deleted_at: null, family_id: 'f2' }, quantity: 4, issued_at: '2026-10-09T05:00:00Z' }),
  ],
  [usage({ id: 'u1' }), usage({ id: 'u2', used_at: '2026-10-11T03:40:00Z', used_via: 'admin', person: { name: '김철수', deleted_at: null, family_id: 'f1' } })],
  [
    { family_id: 'f1', meal_id: 'm1', issued: 3, used: 2, remaining: 1, amount: 15000 },
    { family_id: 'f2', meal_id: 'm1', issued: 4, used: 0, remaining: 4, amount: 20000 },
  ],
)
const detail: MealDetail = { meal, ledger }

function renderPage(path = '/admin/meals/m1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/meals/:mealId" element={<MealDetailPage />} />
        <Route path="/admin/meals" element={<p>식사 목록</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useMealDetail.mockReturnValue({ status: 'success', data: detail, refetch: vi.fn<() => void>() })
})

describe('MealDetailPage', () => {
  it('식사 제목, 네 숫자 한 줄, 가족별 블록(라벨 · N장 중 M장 사용 · 발급·사용 줄)', () => {
    renderPage()
    expect(useMealDetail).toHaveBeenCalledWith('m1')
    expect(screen.getByRole('heading', { level: 1, name: '10월 11일 (주일) · 주일 점심' })).toBeInTheDocument()
    expect(screen.getByText('발급 7장 · 사용 2장 · 남음 5장 · 35,000원')).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: '가족별 현황' })).getAllByRole('listitem', { name: /./ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['김철수 · 이영희', '박민수'])
    const f1 = rows[0]!
    expect(f1).toHaveTextContent('3장 중 2장 사용')
    expect(f1).toHaveTextContent('남음 1장 · 15,000원')
    // 발급 줄: 최근 것부터, 취소된 것은 취소됨 표시
    expect(f1).toHaveTextContent('발급 1장 · 이영희 · 5,000원')
    expect(f1).toHaveTextContent('10/10 14:00 · 권사 · 입금 확인')
    expect(f1).toHaveTextContent('취소됨 · 실수')
    // 사용 줄: 자녀 폰 / 담당자 처리
    expect(f1).toHaveTextContent('사용 1장 · 김철수 몫 · 담당자 처리')
    expect(f1).toHaveTextContent('사용 1장 · 서연 폰')
  })

  it('이름으로 찾으면 그 가족만 남고, 없으면 안내', async () => {
    renderPage()
    const box = screen.getByLabelText('이름으로 찾기')
    await userEvent.type(box, '민수')
    expect(within(screen.getByRole('list', { name: '가족별 현황' })).getAllByRole('listitem', { name: /./ }).map((r) => r.getAttribute('aria-label'))).toEqual(['박민수'])
    await userEvent.clear(box)
    await userEvent.type(box, '없는사람')
    expect(screen.getByText('찾는 가족이 없어요')).toBeInTheDocument()
  })

  it('발급이 아예 없으면(검색어 없이) "아직 발급이 없어요" — 검색 실패 문구와 구분', () => {
    useMealDetail.mockReturnValue({
      status: 'success',
      data: { meal, ledger: { totals: { issued: 0, used: 0, remaining: 0, amount: 0 }, families: [] } },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    expect(screen.getByText('아직 발급이 없어요')).toBeInTheDocument()
    expect(screen.queryByText('찾는 가족이 없어요')).not.toBeInTheDocument()
  })

  it('"← 식사" 링크는 식사 목록으로', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: '← 식사' }))
    expect(screen.getByText('식사 목록')).toBeInTheDocument()
  })

  it('식사가 없으면(null) 안내만', () => {
    useMealDetail.mockReturnValue({ status: 'success', data: null, refetch: vi.fn<() => void>() })
    renderPage('/admin/meals/gone')
    expect(screen.getByRole('alert')).toHaveTextContent('식사를 찾을 수 없어요')
    expect(screen.queryByRole('list', { name: '가족별 현황' })).not.toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useMealDetail.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    useMealDetail.mockReturnValue({ status: 'error', refetch })
    rerender(
      <MemoryRouter initialEntries={['/admin/meals/m1']}>
        <Routes>
          <Route path="/admin/meals/:mealId" element={<MealDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다 (data 로 분기)', () => {
    useMealDetail.mockReturnValue({ status: 'error', data: detail, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 현황을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '가족별 현황' })).toBeInTheDocument()
  })
})
