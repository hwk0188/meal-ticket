import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TicketGroup } from './groupTickets'
import { TodayMealCard } from './TodayMealCard'

const { useUseTicket } = vi.hoisted(() => ({
  useUseTicket: vi.fn<() => { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown }>(),
}))
vi.mock('./useUseTicket', () => ({ useUseTicket }))
vi.mock('./Clock', () => ({ Clock: () => <span>12:31:07</span> }))

const group: TicketGroup = {
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' },
  issued: 4, used: 1, remaining: 3, amount: 20000,
}
const idle = { mutate: vi.fn<() => void>(), isPending: false, isError: false, isSuccess: false, error: null }

describe('TodayMealCard', () => {
  it('식사명·날짜·시계·남은 장수·안내문을 보여 준다', () => {
    useUseTicket.mockReturnValue(idle)
    render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('heading', { name: '주일 점심' })).toBeInTheDocument()
    expect(screen.getByText('오늘 · 10월 11일 (주일)')).toBeInTheDocument()
    expect(screen.getByText('12:31:07')).toBeInTheDocument()
    expect(screen.getByText('3장 남음')).toBeInTheDocument()
    expect(screen.getByText('담당자가 식권을 꾹 눌러 주세요')).toBeInTheDocument()
  })

  it('식권이 없으면 목록 대신 안내', () => {
    useUseTicket.mockReturnValue(idle)
    render(<TodayMealCard group={{ ...group, issued: 0, used: 0, remaining: 0 }} usages={[]} members={[]} online />)
    expect(screen.getByText('이 식사의 식권이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('처리 중이면 상태를 보여 주고, 오프라인이면 사용 버튼을 잠근다', () => {
    useUseTicket.mockReturnValue({ ...idle, isPending: true })
    const { rerender } = render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('status')).toHaveTextContent('처리 중…')

    useUseTicket.mockReturnValue(idle)
    rerender(<TodayMealCard group={group} usages={[]} members={[]} online={false} />)
    for (const b of screen.getAllByRole('button', { name: /꾹 눌러 사용/ })) expect(b).toBeDisabled()
  })

  it('오류는 문구로, 성공은 확인 문구로', () => {
    useUseTicket.mockReturnValue({ ...idle, isError: true, error: { message: 'no_remaining', code: 'P0001' } })
    const { rerender } = render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('alert')).toHaveTextContent('방금 다른 폰에서 사용되었어요.')

    useUseTicket.mockReturnValue({ ...idle, isSuccess: true })
    rerender(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('status')).toHaveTextContent('사용 처리되었어요')
  })

  it('목록의 onUse 가 mutate 를 부른다 (키보드 Enter 로도 된다)', async () => {
    const mutate = vi.fn<() => void>()
    useUseTicket.mockReturnValue({ ...idle, mutate })
    render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    const [first] = screen.getAllByRole('button', { name: /꾹 눌러 사용/ })
    first!.focus()
    await userEvent.keyboard('{Enter}')
    expect(mutate).toHaveBeenCalledOnce()
  })
})
