import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { PairPage } from './PairPage'

type PairingQuery = { status: 'pending' | 'error' | 'success'; data?: { code: string; expires_at: string } | null; error: Error | null }

const { useAuth, usePerson, usePairingCode } = vi.hoisted(() => ({
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string } } }>(),
  usePerson: vi.fn<(userId: string | undefined, options?: { refetchInterval?: number | false }) => unknown>(),
  usePairingCode: vi.fn<() => PairingQuery>(),
}))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/auth/usePerson', () => ({ usePerson }))
vi.mock('../features/pairing/usePairingCode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/pairing/usePairingCode')>()),
  usePairingCode,
}))
vi.mock('../features/pairing/PairingCodeCard', () => ({ PairingCodeCard: ({ kind }: { kind: string }) => <p>card:{kind}</p> }))
vi.mock('../components/SignOutButton', () => ({ SignOutButton: ({ label }: { label: string }) => <button type="button">{label}</button> }))

describe('PairPage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    usePairingCode.mockReturnValue({ status: 'success', data: { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }, error: null })
  })

  it('자녀 코드 카드와 안내, 처음으로 버튼을 보여 준다', () => {
    render(<MemoryRouter><PairPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '보호자에게 이 코드를 보여 주세요' })).toBeInTheDocument()
    expect(screen.getByText('card:child')).toBeInTheDocument()
    expect(screen.getByText(/홈 화면에 추가/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처음으로 돌아가기' })).toBeInTheDocument()
  })

  it('보호자가 연결하면 바로 알 수 있게 내 사람 행을 3초마다 확인한다', () => {
    render(<MemoryRouter><PairPage /></MemoryRouter>)
    expect(usePerson).toHaveBeenCalledWith('k1', { refetchInterval: PAIR_POLL_MS })
  })

  it('하루 넘게 연결되지 않아 정리된 계정이면 처음으로 돌아가라는 안내를 크게 보여 준다', () => {
    usePairingCode.mockReturnValue({ status: 'error', data: undefined, error: new Error('not_authenticated') })
    render(<MemoryRouter><PairPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('이 폰의 아이 계정이 정리되었어요')
    expect(screen.queryByText('잘못 들어왔거나 코드를 받을 수 없다면 처음으로 돌아가 다시 시작할 수 있어요.')).not.toBeInTheDocument()
  })
})
