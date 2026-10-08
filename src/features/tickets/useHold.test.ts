import { act, renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { HOLD_MS, useHold } from './useHold'

const down = (button = 0) => ({ button, preventDefault: () => {} }) as unknown as PointerEvent<HTMLElement>

describe('useHold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('600ms 누르고 있으면 onComplete 를 한 번 부른다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    expect(HOLD_MS).toBe(600)

    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(true)
    act(() => vi.advanceTimersByTime(599))
    expect(onComplete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(result.current.holding).toBe(false)
  })

  it('먼저 떼면 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.handlers.onPointerUp())
    expect(result.current.holding).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('손가락이 벗어나거나(leave) 스크롤로 끊기면(cancel) 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => result.current.handlers.onPointerLeave())
    act(() => vi.advanceTimersByTime(1000))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => result.current.handlers.onPointerCancel())
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('disabled 면 누름을 시작하지 않고, 누르는 중 disabled 가 되면 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result, rerender } = renderHook(({ disabled }) => useHold({ onComplete, disabled }), { initialProps: { disabled: true } })
    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(false)

    rerender({ disabled: false })
    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(true)
    rerender({ disabled: true })
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('마우스 오른쪽 버튼은 무시한다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down(2)))
    expect(result.current.holding).toBe(false)
  })

  it('언마운트되면 타이머를 치운다', () => {
    const onComplete = vi.fn<() => void>()
    const { result, unmount } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })
})
