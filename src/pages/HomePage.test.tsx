import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../features/auth/usePerson'
import { HomePage } from './HomePage'

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>() }))
vi.mock('../features/auth/signIn', () => ({ signOut }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['person', 'u1'], person)
  const utils = render(
    <QueryClientProvider client={client}>
      <HomePage person={person} />
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

describe('HomePage', () => {
  it('이름과 가려진 번호, 식사 없음 카드를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '김철수 님' })).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
  })

  it('로그아웃 버튼이 signOut을 부르고 쿼리 캐시를 비운다', async () => {
    signOut.mockResolvedValue(undefined)
    const { client } = renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalled()
    await waitFor(() => expect(client.getQueryData(['person', 'u1'])).toBeUndefined())
  })

  it('로그아웃이 실패하면 안내 문구를 보여준다', async () => {
    signOut.mockRejectedValue(new Error('network'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
  })
})
