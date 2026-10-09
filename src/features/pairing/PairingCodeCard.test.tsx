import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PairingCodeCard } from './PairingCodeCard'
import { PAIR_CODE_TTL_MS } from './usePairingCode'

type Query = {
  status: 'pending' | 'error' | 'success'
  data?: { code: string; expires_at: string }
  // TanStack 의 실제 쿼리 결과는 이 값을 항상 가진다(데이터가 없으면 0) — 옵셔널로 두면 실수로 빠뜨려도
  // 타입 체크를 통과해 버린다.
  dataUpdatedAt: number
  error?: Error
  isFetching: boolean
  refetch: () => Promise<unknown>
}
const { usePairingCode, useCountdown } = vi.hoisted(() => ({
  usePairingCode: vi.fn<() => Query>(),
  useCountdown: vi.fn<() => number>(),
}))
vi.mock('./usePairingCode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePairingCode')>()),
  usePairingCode,
}))
vi.mock('./useCountdown', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCountdown')>()),
  useCountdown,
}))

const data = { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }
const dataUpdatedAt = Date.parse('2026-10-12T03:30:00Z')

describe('PairingCodeCard', () => {
  it('코드를 네 자리씩 띄워 크게 보여 주고 남은 시간을 알린다', () => {
    const refetch = vi.fn<() => Promise<unknown>>()
    usePairingCode.mockReturnValue({ status: 'success', data, dataUpdatedAt, isFetching: false, refetch })
    useCountdown.mockReturnValue(581)
    render(<PairingCodeCard kind="child" hint="보호자 앱에서 입력해 주세요" />)
    expect(screen.getByTestId('pairing-code')).toHaveTextContent('4829 1357')
    expect(screen.getByRole('status')).toHaveTextContent('9분 41초 남음 · 1회용')
    expect(screen.getByText('보호자 앱에서 입력해 주세요')).toBeInTheDocument()
    expect(usePairingCode).toHaveBeenCalledWith('child')
    // 서버 만료 시각이 아니라 쿼리 도착 시각 + TTL 로 센다 (폰 시계 하나로 통일).
    expect(useCountdown).toHaveBeenCalledWith(dataUpdatedAt + PAIR_CODE_TTL_MS)
  })

  it('만료되면 코드를 흐리게 하고 안내한다', () => {
    usePairingCode.mockReturnValue({ status: 'success', data, dataUpdatedAt, isFetching: false, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('코드가 만료되었어요')
    expect(screen.getByTestId('pairing-code')).toHaveClass('line-through')
    // 눈에 보이는 안내 옆에, 스크린 리더에게만 한 번 알리는 알림이 따로 있다 (role=status 와는 별개).
    expect(screen.getByRole('alert')).toHaveTextContent('연결 코드가 만료되었어요')
  })

  it('"새 코드 받기" 는 refetch 를 부르고, 받는 중에는 잠근다', async () => {
    const refetch = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    usePairingCode.mockReturnValue({ status: 'success', data, dataUpdatedAt, isFetching: false, refetch })
    useCountdown.mockReturnValue(10)
    const { rerender } = render(<PairingCodeCard kind="adult" hint="" />)
    await userEvent.click(screen.getByRole('button', { name: '새 코드 받기' }))
    expect(refetch).toHaveBeenCalledOnce()
    usePairingCode.mockReturnValue({ status: 'success', data, dataUpdatedAt, isFetching: true, refetch })
    rerender(<PairingCodeCard kind="adult" hint="" />)
    expect(screen.getByRole('button', { name: /새 코드 받기|받는 중/ })).toBeDisabled()
  })

  it('받는 중이면 스피너, 실패하면 문구', () => {
    usePairingCode.mockReturnValue({ status: 'pending', dataUpdatedAt: 0, isFetching: true, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    const { rerender } = render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    usePairingCode.mockReturnValue({
      status: 'error',
      error: new Error('already_registered'),
      dataUpdatedAt: 0,
      isFetching: false,
      refetch: vi.fn<() => Promise<unknown>>(),
    })
    rerender(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('alert')).toHaveTextContent('이미 가입된 계정이에요.')
  })

  it('재발급 실패해도 이전 코드는 그대로 두고, 작은 안내만 보여 준다', () => {
    usePairingCode.mockReturnValue({
      status: 'error',
      data,
      dataUpdatedAt,
      error: new Error('network'),
      isFetching: false,
      refetch: vi.fn<() => Promise<unknown>>(),
    })
    useCountdown.mockReturnValue(300)
    render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByTestId('pairing-code')).toHaveTextContent('4829 1357')
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('새 코드를 받지 못했어요. 다시 눌러 주세요.')).toBeInTheDocument()
  })
})
