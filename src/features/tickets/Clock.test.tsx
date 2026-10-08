import { act, render, screen } from '@testing-library/react'
import { Clock } from './Clock'

describe('Clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T03:31:07Z')) // 12:31:07 KST
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('서울 시각을 초 단위로 보여 주고 1초마다 간다', () => {
    render(<Clock />)
    expect(screen.getByText('12:31:07')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('12:31:08')).toBeInTheDocument()
  })

  it('언마운트되면 인터벌을 치운다', () => {
    const { unmount } = render(<Clock />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
