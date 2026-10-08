import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import type { FamilyTickets } from '../features/tickets/useFamilyTickets'
import { HomePage } from './HomePage'

const { signOut, useAuth, useFamilyTickets, useOnline } = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<void>>(),
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string; is_anonymous?: boolean } } }>(),
  useFamilyTickets: vi.fn<() => { status: 'pending' | 'error' | 'success'; data?: FamilyTickets; refetch: () => void }>(),
  useOnline: vi.fn<() => boolean>(),
}))
vi.mock('../features/auth/signIn', () => ({ signOut }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/tickets/useFamilyTickets', () => ({ useFamilyTickets, ticketsQueryKey: ['tickets'] }))
vi.mock('../features/tickets/useOnline', () => ({ useOnline }))
vi.mock('../features/tickets/TodayMealCard', () => ({
  TodayMealCard: ({ group }: { group: { meal: { title: string } } }) => <p>오늘카드:{group.meal.title}</p>,
}))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' })
const group = (id: string, served_on: string, issued: number, used: number) => ({ meal: meal(id, served_on), issued, used, remaining: issued - used, amount: issued * 5000 })
const empty: FamilyTickets = { today: [], upcoming: [], past: [], usages: [], members: [{ id: 'p1', name: '김철수' }] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['person', 'u1'], person)
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage person={person} /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

beforeEach(() => {
  useOnline.mockReturnValue(true)
  useFamilyTickets.mockReturnValue({ status: 'success', data: empty, refetch: () => {} })
  useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1', is_anonymous: false } } })
})

describe('HomePage · 머리말', () => {
  it('이름·가려진 번호·"내 식권"(1인 가족)·처리방침 링크', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '김철수 님' })).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('내 식권')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toBeInTheDocument()
  })

  it('가족이 둘 이상이면 "우리 가족 식권 · N명"', () => {
    useFamilyTickets.mockReturnValue({ status: 'success', data: { ...empty, members: [{ id: 'p1', name: '김철수' }, { id: 'p2', name: '서연' }] }, refetch: () => {} })
    renderPage()
    expect(screen.getByText('우리 가족 식권 · 2명')).toBeInTheDocument()
  })

  it('오프라인이면 배지를 보여 준다', () => {
    useOnline.mockReturnValue(false)
    renderPage()
    expect(screen.getByText(/오프라인/)).toBeInTheDocument()
  })
})

describe('HomePage · 식권 구역', () => {
  it('처음 불러오는 중(data 없음)이면 인라인 스피너', () => {
    useFamilyTickets.mockReturnValue({ status: 'pending', refetch: () => {} })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
  })

  it('data 없이 실패하면 안내와 "다시 시도" 버튼 — 누르면 refetch 를 부른다', async () => {
    const refetch = vi.fn<() => void>()
    useFamilyTickets.mockReturnValue({ status: 'error', refetch })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('식권을 불러오지 못했어요')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('data 가 있는 채로 폴링이 실패하면 목록은 그대로, 조용한 안내만 보여 준다 (경보 아님)', () => {
    useFamilyTickets.mockReturnValue({ status: 'error', data: empty, refetch: () => {} })
    renderPage()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('최신 정보를 받지 못했어요')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('오늘 식사가 없으면 안내 카드 + 다가오는 식권 + 접힌 지난 식권', async () => {
    useFamilyTickets.mockReturnValue({
      status: 'success', refetch: () => {},
      data: { ...empty, upcoming: [group('m2', '2026-10-18', 4, 0)], past: [group('m0', '2026-10-04', 2, 1)] },
    })
    renderPage()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
    expect(screen.getByText('10월 18일 (주일) · 주일 점심')).toBeInTheDocument()
    expect(screen.getByText('4장')).toBeInTheDocument()
    const past = screen.getByText('지난 식권 1건')
    expect(screen.queryByText('미사용 1장')).not.toBeVisible()
    await userEvent.click(past)
    expect(screen.getByText('미사용 1장')).toBeVisible()
  })

  it('오늘 식사가 있으면 카드를 식사마다 그리고, 다음 식권 한 줄을 붙인다', () => {
    useFamilyTickets.mockReturnValue({
      status: 'success', refetch: () => {},
      data: { ...empty, today: [group('m1', '2026-10-12', 4, 1), { ...group('m3', '2026-10-12', 0, 0), meal: meal('m3', '2026-10-12', '저녁') }], upcoming: [group('m2', '2026-10-18', 4, 0)] },
    })
    renderPage()
    expect(screen.getByText('오늘카드:주일 점심')).toBeInTheDocument()
    expect(screen.getByText('오늘카드:저녁')).toBeInTheDocument()
    expect(screen.getByText('다음 · 10/18 주일 점심 · 4장')).toBeInTheDocument()
    expect(screen.queryByText('오늘은 식사가 없어요')).not.toBeInTheDocument()
  })
})

describe('HomePage · 로그아웃', () => {
  it('로그아웃 버튼이 signOut 을 부른다 (캐시 정리는 AuthProvider 의 SIGNED_OUT 처리가 맡는다)', async () => {
    signOut.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('아이(익명) 계정은 로그아웃 전에 한 번 더 묻는다', async () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1', is_anonymous: true } } })
    signOut.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByText(/보호자가 새 코드로/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '네, 로그아웃' }))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('로그아웃 중에는 버튼을 잠가 두 번 호출되지 않는다', async () => {
    let settle: () => void = () => {}
    signOut.mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    renderPage()
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    await act(async () => {
      settle()
    })
  })

  it('로그아웃이 실패하면 안내 문구를 보여 준다', async () => {
    signOut.mockRejectedValue(new Error('network'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
  })

  it('다시 시도해 성공하면 안내 문구를 지운다', async () => {
    signOut.mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '로그아웃' })

    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // 실패 뒤에는 버튼이 다시 살아나야 사용자가 할 수 있는 일이 남는다.
    expect(button).not.toBeDisabled()

    await userEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
