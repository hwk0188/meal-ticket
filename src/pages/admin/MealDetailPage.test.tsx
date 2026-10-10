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

type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useCancelIssuance, useVoidUsage, useUseTicketAsAdmin } = vi.hoisted(() => ({
  useCancelIssuance: vi.fn<(mealId: string) => M>(),
  useVoidUsage: vi.fn<(mealId: string) => M>(),
  useUseTicketAsAdmin: vi.fn<(mealId: string) => M>(),
}))
vi.mock('../../features/admin/useMealOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMealOps')>()),
  useCancelIssuance,
  useVoidUsage,
  useUseTicketAsAdmin,
}))
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

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
  [
    usage({ id: 'u1' }),
    usage({ id: 'u2', used_at: '2026-10-11T03:40:00Z', used_via: 'admin', person: { name: '김철수', deleted_at: null, family_id: 'f1' } }),
    // 이미 무효 처리된 줄 — 버튼 없이 "무효" 표시만 있어야 한다
    usage({ id: 'u3', used_at: '2026-10-11T03:50:00Z', voided_at: '2026-10-11T04:00:00Z', person: { name: '서연', deleted_at: null, family_id: 'f1' } }),
  ],
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
  useCancelIssuance.mockReturnValue(idle())
  useVoidUsage.mockReturnValue(idle())
  useUseTicketAsAdmin.mockReturnValue(idle())
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

  it('"1장 대신 사용" 은 확인을 거쳐 가장 최근 구매자 몫으로 use_ticket_as_admin, 성공하면 알림', async () => {
    const use = idle()
    use.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUseTicketAsAdmin.mockReturnValue(use)
    renderPage()
    expect(useUseTicketAsAdmin).toHaveBeenCalledWith('m1')
    await userEvent.click(screen.getByRole('button', { name: '김철수 · 이영희 1장 대신 사용' }))
    expect(use.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '사용 처리' }))
    expect(use.mutate).toHaveBeenCalledWith({ personId: 'p3', familyId: 'f1' }, expect.anything()) // f1 의 최근 활성 발급 구매자 = 이영희(p3)
    expect(screen.getByText('김철수 · 이영희 가족 식권 1장을 사용 처리했어요')).toBeInTheDocument()
  })

  it('남은 장수가 0 이면 "1장 대신 사용" 이 잠긴다', () => {
    const zero = groupMealLedger([issuance({ quantity: 1 })], [usage({})], [{ family_id: 'f1', meal_id: 'm1', issued: 1, used: 1, remaining: 0, amount: 5000 }])
    useMealDetail.mockReturnValue({ status: 'success', data: { meal, ledger: zero }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByRole('button', { name: '김철수 1장 대신 사용' })).toBeDisabled()
  })

  it('구매자를 특정할 수 없으면(가족 이동 등) "1장 대신 사용" 이 잠기고 안내가 보인다', () => {
    // 산 사람(김철수)이 활성 발급 뒤 다른 가족(f9)으로 옮겨서, 이 가족(f5)엔 "누구 몫"으로 정할 사람이 없다.
    const noBuyer = groupMealLedger(
      [issuance({ family_id: 'f5', buyer: { name: '김철수', deleted_at: null, family_id: 'f9' } })],
      [],
      [{ family_id: 'f5', meal_id: 'm1', issued: 2, used: 0, remaining: 2, amount: 10000 }],
    )
    useMealDetail.mockReturnValue({ status: 'success', data: { meal, ledger: noBuyer }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByRole('button', { name: '김철수 1장 대신 사용' })).toBeDisabled()
    expect(screen.getByText('대신 사용 처리할 구매자가 없어요 (탈퇴했거나 가족을 옮겼어요)')).toBeInTheDocument()
  })

  it('"발급 취소" 는 남은 장수 안의 발급에만 열리고, 확인을 거쳐 cancel_issuance', async () => {
    const cancel = idle()
    cancel.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useCancelIssuance.mockReturnValue(cancel)
    renderPage()
    // f1: 남음 1. 이영희 1장(i2) → 가능. 김철수 2장(i1) → 불가 + 안내. 취소된 i3 에는 버튼이 없다.
    const blocked = screen.getByRole('button', { name: /김철수 2장 발급 취소$/ })
    expect(blocked).toBeDisabled()
    expect(screen.getByText('남은 장수(1)보다 많아 취소할 수 없어요 — 먼저 사용을 무효 처리해 주세요')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /발급 취소$/ })).toHaveLength(3) // i1, i2, f2 의 박민수 4장
    await userEvent.click(screen.getByRole('button', { name: /이영희 1장 발급 취소$/ }))
    await userEvent.click(screen.getByRole('button', { name: '취소하기' }))
    expect(cancel.mutate).toHaveBeenCalledWith('i2', expect.anything())
    expect(screen.getByText('이영희 님 1장 발급을 취소했어요')).toBeInTheDocument()
  })

  it('"무효" 는 무효 아닌 사용 줄에만 있고, 확인을 거쳐 void_usage. 이미 무효인 줄엔 버튼이 없다', async () => {
    const voidUsage = idle()
    voidUsage.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    expect(screen.getAllByRole('button', { name: /무효$/ })).toHaveLength(2) // u1, u2 — u3 는 이미 무효
    expect(screen.queryByRole('button', { name: /서연 폰 10\/11 12:50 사용 무효$/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /10\/11 12:40 사용 무효$/ }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    expect(voidUsage.mutate).toHaveBeenCalledWith('u2', expect.anything())
    expect(screen.getByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')).toBeInTheDocument()
  })

  it('처리 중에는 모든 동작 버튼이 "처리 중…" 으로 잠긴다 (발급 취소가 진행 중일 때)', () => {
    useCancelIssuance.mockReturnValue({ ...idle(), isPending: true })
    renderPage()
    // 2 가족 · 활성 발급 3(i1,i2,i4) · 활성 사용 2(u1,u2) · 가족별 대신 사용 2(f1,f2)
    const busy = screen.getAllByRole('button', { name: /처리 중…$/ })
    expect(busy).toHaveLength(7)
    for (const b of busy) expect(b).toBeDisabled()
    expect(screen.queryByRole('button', { name: /발급 취소$/ })).not.toBeInTheDocument()
  })

  it('처리 중에는 모든 동작 버튼이 "처리 중…" 으로 잠긴다 (무효 처리가 진행 중일 때)', () => {
    useVoidUsage.mockReturnValue({ ...idle(), isPending: true })
    renderPage()
    expect(screen.getAllByRole('button', { name: /처리 중…$/ })).toHaveLength(7)
  })

  it('동작 오류 문구를 보여 주고, 다음 동작이 시작되면 세 뮤테이션을 reset 한다', async () => {
    const cancel = { ...idle(), isError: true, error: new Error('would_go_negative') }
    const voidUsage = idle()
    useCancelIssuance.mockReturnValue(cancel)
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('이미 사용된 장수가 있어 이 발급은 취소할 수 없어요')
    await userEvent.click(screen.getByRole('button', { name: /10\/11 12:40 사용 무효$/ }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    expect(cancel.reset).toHaveBeenCalled()
    expect(voidUsage.reset).toHaveBeenCalled()
  })

  it('no_remaining 오류는 관리자 맥락 문구로 보인다 (교인 폰 문구가 아니다)', () => {
    useUseTicketAsAdmin.mockReturnValue({ ...idle(), isError: true, error: new Error('no_remaining') })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('남은 식권이 없어요. 현황을 다시 불러왔어요.')
  })

  it('성공 알림은 다음 동작이 시작되면 사라진다', async () => {
    const voidUsage = idle()
    voidUsage.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /10\/11 12:40 사용 무효$/ }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    expect(screen.getByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')).toBeInTheDocument()
    // 다음 동작(발급 취소, 성공 알림 없음)을 시작하면 이전 알림이 사라진다
    await userEvent.click(screen.getByRole('button', { name: /이영희 1장 발급 취소$/ }))
    await userEvent.click(screen.getByRole('button', { name: '취소하기' }))
    expect(screen.queryByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')).not.toBeInTheDocument()
  })

  it('성공하면 피드백 영역에 포커스가 간다', async () => {
    const voidUsage = idle()
    voidUsage.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /10\/11 12:40 사용 무효$/ }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    const notice = screen.getByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')
    expect(document.activeElement).toBe(notice.closest('[tabindex="-1"]'))
  })
})
