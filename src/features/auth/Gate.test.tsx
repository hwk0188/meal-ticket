import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Gate, RequireAdmin, RequirePerson, RequireSession } from './Gate'

// 훅을 통째로 가짜로 바꾸므로 실제 타입(Session, UseQueryResult) 전체를 만들 필요가 없다.
// Gate 가 읽는 필드만 담은 느슨한 타입으로 둔다.
type FakeAuth = { status: 'loading' | 'ready'; session?: { user: { id: string } } | null }
type FakePerson = {
  status: 'pending' | 'error' | 'success'
  data?: { id: string; name: string; role?: string; family_id?: string } | null
}

const { useAuth, usePerson, useCurrentPerson } = vi.hoisted(() => ({
  useAuth: vi.fn<() => FakeAuth>(),
  usePerson: vi.fn<() => FakePerson>(),
  useCurrentPerson: vi.fn<() => { role: string }>(),
}))
vi.mock('./AuthProvider', () => ({ useAuth }))
vi.mock('./usePerson', () => ({ usePerson, useCurrentPerson }))
vi.mock('../../pages/StartPage', () => ({ StartPage: () => <p>start</p> }))
vi.mock('../../pages/HomePage', () => ({ HomePage: () => <p>home</p> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/onboarding" element={<RequireSession><p>onboarding</p></RequireSession>} />
        <Route element={<RequirePerson />}>
          <Route path="/history" element={<p>history</p>} />
          <Route path="/admin/meals" element={<RequireAdmin><p>admin</p></RequireAdmin>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Gate', () => {
  it('세션 확인 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'loading' })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('세션이 없으면 시작 화면', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('사람을 불러오는 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('세션은 있고 사람이 없으면 가입 화면으로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/')
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('사람이 있으면 홈', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수' } })
    renderAt('/')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('사람 조회가 실패하면 안내 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'error', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toHaveTextContent('연결에 문제가 있어요')
  })

  it('RequireSession: 세션 확인 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'loading' })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('RequireSession: 사람을 불러오는 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    // 가입 여부를 모르는 채로 가입 화면을 깜빡이며 보여 주지 않는다.
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('RequireSession: 세션이 없으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('RequireSession: 사람 조회가 실패하면 가입 화면을 열지 않는다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'error', data: undefined })
    renderAt('/onboarding')
    // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키면 안 된다.
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('연결에 문제가 있어요')
  })

  it('RequireSession: 이미 가입했으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수' } })
    renderAt('/onboarding')
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})

describe('RequirePerson', () => {
  it('세션이 없으면 홈으로 보낸다 (홈이 시작 화면을 띄운다)', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/history')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('가입 전이면 가입 화면으로', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/history')
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('가입한 사람은 통과하고 하단 탭이 붙는다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수', role: 'member', family_id: 'f1' } })
    renderAt('/history')
    expect(screen.getByText('history')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  it('교인은 홈으로 돌려보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수', role: 'member', family_id: 'f1' } })
    useCurrentPerson.mockReturnValue({ role: 'member' })
    renderAt('/admin/meals')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('관리자는 통과', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u9' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p9', name: '권사', role: 'admin', family_id: 'f9' } })
    useCurrentPerson.mockReturnValue({ role: 'admin' })
    renderAt('/admin/meals')
    expect(screen.getByText('admin')).toBeInTheDocument()
  })
})
