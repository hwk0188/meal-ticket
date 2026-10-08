import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PairingCodeCard } from './PairingCodeCard'

type Query = { status: 'pending' | 'error' | 'success'; data?: { code: string; expires_at: string }; error?: Error; isFetching: boolean; refetch: () => Promise<unknown> }
const { usePairingCode, useCountdown } = vi.hoisted(() => ({
  usePairingCode: vi.fn<() => Query>(),
  useCountdown: vi.fn<() => number>(),
}))
vi.mock('./usePairingCode', () => ({ usePairingCode }))
vi.mock('./useCountdown', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCountdown')>()),
  useCountdown,
}))

const data = { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }

describe('PairingCodeCard', () => {
  it('코드를 네 자리씩 띄워 크게 보여 주고 남은 시간을 알린다', () => {
    const refetch = vi.fn<() => Promise<unknown>>()
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch })
    useCountdown.mockReturnValue(581)
    render(<PairingCodeCard kind="child" hint="보호자 앱에서 입력해 주세요" />)
    expect(screen.getByTestId('pairing-code')).toHaveTextContent('4829 1357')
    expect(screen.getByRole('status')).toHaveTextContent('9분 41초 남음 · 1회용')
    expect(screen.getByText('보호자 앱에서 입력해 주세요')).toBeInTheDocument()
    expect(usePairingCode).toHaveBeenCalledWith('child')
  })

  it('만료되면 코드를 흐리게 하고 안내한다', () => {
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('코드가 만료되었어요')
    expect(screen.getByTestId('pairing-code')).toHaveClass('line-through')
  })

  it('"새 코드 받기" 는 refetch 를 부르고, 받는 중에는 잠근다', async () => {
    const refetch = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch })
    useCountdown.mockReturnValue(10)
    const { rerender } = render(<PairingCodeCard kind="adult" hint="" />)
    await userEvent.click(screen.getByRole('button', { name: '새 코드 받기' }))
    expect(refetch).toHaveBeenCalledOnce()
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: true, refetch })
    rerender(<PairingCodeCard kind="adult" hint="" />)
    expect(screen.getByRole('button', { name: '새 코드 받기' })).toBeDisabled()
  })

  it('받는 중이면 스피너, 실패하면 문구', () => {
    usePairingCode.mockReturnValue({ status: 'pending', isFetching: true, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    const { rerender } = render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    usePairingCode.mockReturnValue({ status: 'error', error: new Error('already_registered'), isFetching: false, refetch: vi.fn<() => Promise<unknown>>() })
    rerender(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('alert')).toHaveTextContent('이미 가입된 계정이에요.')
  })
})
