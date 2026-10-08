import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AdminMealsPage } from './AdminMealsPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T }
type M = { mutate: (...args: never[]) => void; mutateAsync: (...args: never[]) => Promise<unknown>; isPending: boolean; isError: boolean; error: unknown; reset: () => void }
const { useMeals, useAdminBalances, useCreateNextSundayLunch, useAddMeal, useDeleteMeal } = vi.hoisted(() => ({
  useMeals: vi.fn<() => Q<unknown[]>>(),
  useAdminBalances: vi.fn<() => Q<unknown[]>>(),
  useCreateNextSundayLunch: vi.fn<() => M>(),
  useAddMeal: vi.fn<() => M>(),
  useDeleteMeal: vi.fn<() => M>(),
}))
vi.mock('../../features/admin/useMeals', () => ({ useMeals, useAdminBalances, useCreateNextSundayLunch, useAddMeal, useDeleteMeal }))
vi.mock('../../lib/dates', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/dates')>()), todaySeoul: () => '2026-10-08' }))

const idle = (): M => ({ mutate: vi.fn<() => void>(), mutateAsync: vi.fn<() => Promise<unknown>>(async () => undefined), isPending: false, isError: false, error: null, reset: () => {} })
const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '' })

beforeEach(() => {
  useMeals.mockReturnValue({ status: 'success', data: [meal('m-past', '2026-10-04'), meal('m1', '2026-10-11'), meal('m2', '2026-10-18')] })
  useAdminBalances.mockReturnValue({ status: 'success', data: [
    { family_id: 'f1', meal_id: 'm1', issued: 4, used: 2, remaining: 2, amount: 20000 },
    { family_id: 'f2', meal_id: 'm1', issued: 2, used: 0, remaining: 2, amount: 10000 },
  ] })
  useCreateNextSundayLunch.mockReturnValue(idle())
  useAddMeal.mockReturnValue(idle())
  useDeleteMeal.mockReturnValue(idle())
})

function renderPage() {
  return render(<MemoryRouter><AdminMealsPage /></MemoryRouter>)
}

describe('AdminMealsPage', () => {
  it('관리자 배지, 다음 주일 점심 버튼에 날짜, 다가오는/지난 구분', () => {
    renderPage()
    expect(screen.getByText('관리자')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 다음 주일 점심 만들기 (10/25)' })).toBeInTheDocument()
    const upcoming = screen.getByRole('region', { name: '다가오는 식사' })
    expect(upcoming).toHaveTextContent('10월 11일 (주일)')
    expect(upcoming).toHaveTextContent('10월 18일 (주일)')
    expect(screen.getByText('지난 식사 1건')).toBeInTheDocument()
  })

  it('카드에 발급·가족·금액·사용률을 보여 주고, 발급 없는 식사만 지울 수 있다', async () => {
    const del = idle()
    useDeleteMeal.mockReturnValue(del)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    const card = screen.getByRole('article', { name: /10월 11일/ })
    expect(card).toHaveTextContent('발급 6장 · 가족 2 · 30,000원')
    expect(card).toHaveTextContent('사용 2 / 6')
    expect(card.querySelector('button')).toBeNull()

    const empty = screen.getByRole('article', { name: /10월 18일/ })
    const deleteButton = empty.querySelector('button')
    expect(deleteButton).not.toBeNull()
    await userEvent.click(deleteButton as HTMLButtonElement)
    expect(window.confirm).toHaveBeenCalled()
    expect(del.mutate).toHaveBeenCalledWith('m2')
  })

  it('다음 주일 점심 버튼은 rpc mutate, 직접 추가는 폼을 열어 add mutate', async () => {
    const next = idle()
    const add = idle()
    useCreateNextSundayLunch.mockReturnValue(next)
    useAddMeal.mockReturnValue(add)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /다음 주일 점심 만들기/ }))
    expect(next.mutate).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '+ 식사 직접 추가' }))
    await userEvent.type(screen.getByLabelText('식사 이름'), '추수감사 점심')
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(add.mutate).toHaveBeenCalledWith({ title: '추수감사 점심', served_on: '2026-10-08', note: null }, expect.anything())
  })

  it('중복 식사(23505)·발급 있는 식사 삭제(23503) 오류를 문구로', () => {
    useAddMeal.mockReturnValue({ ...idle(), isError: true, error: { code: '23505', message: 'duplicate key' } })
    useDeleteMeal.mockReturnValue({ ...idle(), isError: true, error: { code: '23503', message: 'violates foreign key' } })
    renderPage()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(expect.arrayContaining(['같은 값이 이미 있어요.', '연결된 기록이 있어 지울 수 없어요.']))
  })

  it('식사를 불러오지 못하면(데이터 없음) alert 와 다시 시도', () => {
    useMeals.mockReturnValue({ status: 'error' })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('식사를 불러오지 못했어요')
  })
})
