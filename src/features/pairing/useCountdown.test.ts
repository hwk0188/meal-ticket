import { act, renderHook } from '@testing-library/react'
import { formatRemaining, useCountdown } from './useCountdown'

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T03:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('만료까지 남은 초를 1초마다 줄이고 0 에서 멈춘다', () => {
    const { result } = renderHook(() => useCountdown(Date.parse('2026-10-12T03:30:03Z')))
    expect(result.current).toBe(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(2)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(0)
  })

  it('만료 시각이 없으면 0 이고 타이머를 만들지 않는다', () => {
    const { result } = renderHook(() => useCountdown(undefined))
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('새 코드(만료 시각 변경)가 오면 다음 틱부터 새 값으로 센다', () => {
    const { result, rerender } = renderHook(({ at }) => useCountdown(at), {
      initialProps: { at: Date.parse('2026-10-12T03:30:03Z') },
    })
    rerender({ at: Date.parse('2026-10-12T03:40:00Z') })
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(599)
  })

  it('언마운트되면 인터벌을 치운다', () => {
    const { unmount } = renderHook(() => useCountdown(Date.parse('2026-10-12T03:40:00Z')))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('formatRemaining', () => {
  it('분·초', () => {
    expect(formatRemaining(581)).toBe('9분 41초')
    expect(formatRemaining(59)).toBe('0분 59초')
    expect(formatRemaining(0)).toBe('0분 0초')
  })
})
