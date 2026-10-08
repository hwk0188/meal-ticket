import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { IssuePage } from './IssuePage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; fetchStatus?: string; isFetching?: boolean; refetch: () => void }
// 메서드 축약형(mutate(...))은 매개변수를 이변성으로 본다 — M<{name,phone}> 을 vi.fn<() => M<unknown>>() 의
// mockReturnValue 에 넘길 때 화살표 함수 타입(공변·반공변 모두 검사)이면 tsc 가 막는다.
type M<A> = { mutate(args: A, opts?: unknown): void; mutateAsync(args: A): Promise<unknown>; isPending: boolean; isError: boolean; error: unknown; reset(): void }
const { useMeals, usePeopleSearch, useRegisterPerson, useLatestUnitPrice, useIssueTickets, findRecentDuplicate } = vi.hoisted(() => ({
  useMeals: vi.fn<() => Q<unknown[]>>(),
  usePeopleSearch: vi.fn<(q: string) => Q<unknown[]>>(),
  useRegisterPerson: vi.fn<() => M<unknown>>(),
  useLatestUnitPrice: vi.fn<() => Q<number | null>>(),
  useIssueTickets: vi.fn<() => M<unknown>>(),
  findRecentDuplicate: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('../../features/admin/useMeals', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../features/admin/useMeals')>()), useMeals }))
vi.mock('../../features/admin/usePeopleSearch', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../features/admin/usePeopleSearch')>()), usePeopleSearch, useRegisterPerson }))
vi.mock('../../features/admin/useIssue', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../features/admin/useIssue')>()), useLatestUnitPrice, useIssueTickets, findRecentDuplicate }))
vi.mock('../../lib/dates', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/dates')>()), todaySeoul: () => '2026-10-08' }))

const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '' })
const hit = { id: 'p1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', family_id: 'f1', is_minor: false }
const visitor = { ...hit, id: 'p2', name: '이순자', phone: '01022220001', auth_user_id: null }
const idle = <A,>(): M<A> => ({ mutate: vi.fn<() => void>(), mutateAsync: vi.fn<() => Promise<unknown>>(async () => undefined), isPending: false, isError: false, error: null, reset: () => {} })
const q = <T,>(partial: Partial<Q<T>>): Q<T> => ({ status: 'success', refetch: vi.fn<() => void>(), ...partial })

beforeEach(() => {
  useMeals.mockReturnValue(q({ data: [meal('m-next', '2026-10-18'), meal('m1', '2026-10-11'), meal('m-past', '2026-10-04')] }))
  usePeopleSearch.mockReturnValue(q({ status: 'pending', fetchStatus: 'idle', isFetching: false }))
  useRegisterPerson.mockReturnValue(idle())
  useLatestUnitPrice.mockReturnValue(q({ data: 5000 }))
  useIssueTickets.mockReturnValue(idle())
  findRecentDuplicate.mockResolvedValue(false)
})

const renderPage = () => render(<MemoryRouter><IssuePage /></MemoryRouter>)

describe('IssuePage · 1단계 (식사·사람)', () => {
  it('다음 식사가 기본 선택되고 "변경" 으로 바꿀 수 있다', async () => {
    renderPage()
    expect(screen.getByText('10월 11일 (주일) · 주일 점심')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '변경' }))
    await userEvent.click(screen.getByRole('button', { name: '10월 18일 (주일) · 주일 점심' }))
    expect(screen.getByText('10월 18일 (주일) · 주일 점심')).toBeInTheDocument()
  })

  it('식사를 불러오는 중이면 스피너, 실패하면 alert 와 다시 시도', () => {
    useMeals.mockReturnValue(q({ status: 'pending' }))
    const { unmount } = renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()
    const refetch = vi.fn<() => void>()
    useMeals.mockReturnValue(q({ status: 'error', refetch }))
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('식사를 불러오지 못했어요')
  })

  it('검색어를 훅에 넘기고 결과에 가입/미가입 태그와 번호를 보여 준다', async () => {
    usePeopleSearch.mockReturnValue(q({ data: [hit, visitor] }))
    renderPage()
    await userEvent.type(screen.getByLabelText('이름 또는 번호 뒷자리'), '김철')
    expect(usePeopleSearch).toHaveBeenLastCalledWith('김철')
    const rows = screen.getAllByRole('button', { name: /김철수|이순자/ })
    expect(rows[0]).toHaveTextContent('010-1234-5678')
    expect(rows[0]).toHaveTextContent('가입')
    expect(rows[1]).toHaveTextContent('미가입')
  })

  it('"새로 등록" 으로 사람을 만들면 바로 선택된다', async () => {
    const register = idle<{ name: string; phone: string }>()
    register.mutateAsync = vi.fn<() => Promise<unknown>>(async () => visitor)
    useRegisterPerson.mockReturnValue(register)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 새로 등록' }))
    await userEvent.type(screen.getByLabelText('이름'), '이순자')
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-2222-0001')
    await userEvent.click(screen.getByRole('button', { name: '등록하고 선택' }))
    expect(register.mutateAsync).toHaveBeenCalledWith({ name: '이순자', phone: '01022220001' })
    expect(await screen.findByRole('heading', { name: '이순자 님께 발급' })).toBeInTheDocument()
  })
})

describe('IssuePage · 2단계 (장수·단가)', () => {
  async function goToAmount() {
    usePeopleSearch.mockReturnValue(q({ data: [hit] }))
    renderPage()
    await userEvent.type(screen.getByLabelText('이름 또는 번호 뒷자리'), '김철')
    await userEvent.click(screen.getByRole('button', { name: /김철수/ }))
  }

  it('장수 −/+, 최근 단가 기본값, 합계', async () => {
    await goToAmount()
    expect(screen.getByLabelText('단가 (원)')).toHaveValue('5000')
    expect(screen.getByText('합계 5,000원')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '장수 늘리기' }))
    await userEvent.click(screen.getByRole('button', { name: '장수 늘리기' }))
    await userEvent.click(screen.getByRole('button', { name: '장수 줄이기' }))
    expect(screen.getByText('합계 10,000원')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2장 발급하기' })).toBeInTheDocument()
  })

  it('발급하면 issue_tickets 인자가 넘어가고, 성공 뒤 1단계로 돌아가 완료 문구를 띄운다', async () => {
    const issue = idle<{ personId: string }>()
    issue.mutateAsync = vi.fn<() => Promise<unknown>>(async () => ({ id: 'i1' }))
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.type(screen.getByLabelText('메모 (선택)'), '입금 확인')
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({ personId: 'p1', mealId: 'm1', quantity: 1, unitPrice: 5000, memo: '입금 확인' }))
    expect(await screen.findByRole('status')).toHaveTextContent('김철수 님께 1장 발급했어요')
    expect(screen.getByLabelText('이름 또는 번호 뒷자리')).toHaveValue('')
  })

  it('60초 안에 같은 발급이 있으면 확인 창을 거친다 (취소하면 발급 안 함)', async () => {
    findRecentDuplicate.mockResolvedValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const issue = idle()
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(issue.mutateAsync).not.toHaveBeenCalled()
  })

  it('단가가 비면 오류를 보여 주고 보내지 않는다', async () => {
    const issue = idle()
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.clear(screen.getByLabelText('단가 (원)'))
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    expect(screen.getByText('단가를 적어 주세요 (이월은 0)')).toBeInTheDocument()
    expect(issue.mutateAsync).not.toHaveBeenCalled()
  })

  it('서버 오류(person_is_minor 등)는 문구로 보여 준다', async () => {
    useIssueTickets.mockReturnValue({ ...idle(), isError: true, error: { message: 'person_is_minor', code: 'P0001' } })
    await goToAmount()
    expect(screen.getByRole('alert')).toHaveTextContent('자녀 이름으로는 발급할 수 없어요')
  })
})
