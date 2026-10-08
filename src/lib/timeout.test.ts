import { withTimeout } from './timeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('시간이 지나면 TimeoutError 로 abort 된다', () => {
    const { signal } = withTimeout(5000)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(signal.aborted).toBe(true)
    expect((signal.reason as DOMException).name).toBe('TimeoutError')
  })

  it('done() 을 부르면 더는 abort 되지 않는다', () => {
    const { signal, done } = withTimeout(5000)
    done()
    vi.advanceTimersByTime(5000)
    expect(signal.aborted).toBe(false)
  })
})
