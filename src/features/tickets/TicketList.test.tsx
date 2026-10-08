import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TicketList } from './TicketList'

const members = [{ id: 'p1', name: '김철수' }]

describe('TicketList', () => {
  it('식권을 세로로 한 장씩, 번호 "n / 전체" 로 그린다', () => {
    render(<TicketList issued={4} used={1} usages={[]} members={members} canUse onUse={() => {}} pending={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('사용 완료')
    expect(items[0]).toHaveTextContent('1 / 4')
    expect(items[3]).toHaveTextContent('4 / 4')
  })

  it('사용된 장이 3장 이상이면 한 줄로 접고, 누르면 펼친다', async () => {
    render(<TicketList issued={5} used={3} usages={[]} members={members} canUse onUse={() => {}} pending={false} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3) // 접힌 1 + 남은 2
    await userEvent.click(screen.getByRole('button', { name: '사용 완료 3장 펼치기' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('남은 장을 600ms 꾹 누르면 onUse 가 한 번 불린다. 짧게 누르면 아니다', () => {
    vi.useFakeTimers()
    try {
      const onUse = vi.fn<() => void>()
      render(<TicketList issued={2} used={0} usages={[]} members={members} canUse onUse={onUse} pending={false} />)
      const [first] = screen.getAllByRole('button', { name: /꾹 눌러 사용/ })

      act(() => {
        first!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      })
      act(() => vi.advanceTimersByTime(300))
      act(() => {
        first!.dispatchEvent(new Event('pointerup', { bubbles: true }))
      })
      act(() => vi.advanceTimersByTime(600))
      expect(onUse).not.toHaveBeenCalled()

      act(() => {
        first!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      })
      act(() => vi.advanceTimersByTime(600))
      expect(onUse).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('사용할 수 없을 때(canUse=false)는 누름 버튼이 잠긴다', () => {
    render(<TicketList issued={2} used={0} usages={[]} members={members} canUse={false} onUse={() => {}} pending={false} />)
    for (const b of screen.getAllByRole('button', { name: /꾹 눌러 사용/ })) expect(b).toBeDisabled()
  })
})
