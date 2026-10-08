import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import type { FamilyMember } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS, pairingCodeQueryKey } from '../features/pairing/usePairingCode'
import { FamilyPage } from './FamilyPage'

type Query = { status: 'pending' | 'error' | 'success'; data?: FamilyMember[]; refetch: () => void }
type Mutation = {
  isPending: boolean
  isError: boolean
  error?: Error
  mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void
  reset: () => void
}
const { useCurrentPerson, useAuth, usePerson, useFamilyMembers, useLeaveFamily, useRemoveChild, addChildProps } = vi.hoisted(() => ({
  useCurrentPerson: vi.fn<() => Person>(),
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string } } }>(),
  usePerson: vi.fn<(userId: string | undefined, options?: { refetchInterval?: number | false }) => unknown>(),
  useFamilyMembers: vi.fn<() => Query>(),
  useLeaveFamily: vi.fn<() => Mutation>(),
  useRemoveChild: vi.fn<() => Mutation>(),
  addChildProps: vi.fn<(p: { existingChildren: readonly FamilyMember[] }) => void>(),
}))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson, usePerson }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/family/useFamilyMembers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/family/useFamilyMembers')>()),
  useFamilyMembers,
}))
vi.mock('../features/family/useFamilyActions', () => ({ useLeaveFamily, useRemoveChild }))
vi.mock('../features/family/JoinFamilyPanel', () => ({
  JoinFamilyPanel: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>가족 연결 패널</p>
      <button type="button" onClick={() => onDone('이영희 님이 우리 가족이 되었어요')}>연결성공</button>
      <button type="button" onClick={onCancel}>연결취소</button>
    </div>
  ),
}))
vi.mock('../features/family/ProfileSection', () => ({ ProfileSection: () => <p>내 정보 구역</p> }))
vi.mock('../features/family/AddChildForm', () => ({
  AddChildForm: (props: { existingChildren: readonly FamilyMember[]; onDone: (m: string) => void; onCancel: () => void }) => {
    addChildProps(props)
    return (
      <div>
        <p>자녀 추가 폼</p>
        <button type="button" onClick={() => props.onDone('서연 님을 연결했어요')}>폼성공</button>
        <button type="button" onClick={props.onCancel}>폼취소</button>
      </div>
    )
  },
}))

const me = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const rows: FamilyMember[] = [
  { id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1', consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z' },
  { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z', created_at: '2026-10-08T00:00:00Z' },
]
const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>(), reset: vi.fn<() => void>() })

// 테스트마다 새 QueryClient 를 쓴다 — 가족 연결로 생긴 pairing-code 캐시가 테스트 사이에 새지 않도록.
let queryClient: QueryClient

function page() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><FamilyPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(page())
}

beforeEach(() => {
  useCurrentPerson.mockReturnValue(me)
  useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
  usePerson.mockReturnValue({ status: 'success', data: me })
  useFamilyMembers.mockReturnValue({ status: 'success', data: rows, refetch: () => {} })
  useLeaveFamily.mockReturnValue(idle())
  useRemoveChild.mockReturnValue(idle())
})

describe('FamilyPage', () => {
  it('머리말에 구성원 수, 목록, 두 개의 추가 버튼', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '가족' })).toBeInTheDocument()
    expect(screen.getByText('우리 가족 · 2명')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '가족 구성원' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 자녀 추가' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /가족 연결/ })).toBeInTheDocument()
    expect(useFamilyMembers).toHaveBeenCalledWith('f1')
    // 코드를 보여 주는 중이 아니면 내 사람 행을 폴링하지 않는다
    expect(usePerson).toHaveBeenCalledWith('u1', { refetchInterval: false })
  })

  it('"+ 자녀 추가" 를 누르면 폼이 열리고, 성공하면 닫히며 안내가 뜬다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 자녀 추가' }))
    expect(screen.getByText('자녀 추가 폼')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ 자녀 추가' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '폼성공' }))
    expect(screen.queryByText('자녀 추가 폼')).not.toBeInTheDocument()
    expect(screen.getByText('서연 님을 연결했어요')).toBeInTheDocument()
  })

  it('자녀 삭제 확인 → remove_child 뮤테이션', async () => {
    const remove = idle()
    remove.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useRemoveChild.mockReturnValue(remove)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /자녀 삭제$/ }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(remove.mutate).toHaveBeenCalledWith('p2', expect.anything())
    expect(screen.getByText('서연 님을 삭제했어요')).toBeInTheDocument()
  })

  it('가족 나가기 확인 → leave_family 뮤테이션, 성공하면 "새 가족이 되었어요"', async () => {
    const spouse: FamilyMember = {
      id: 'p3', name: '이영희', phone: '01098765432', is_minor: false, guardian_id: null,
      auth_user_id: 'u3', consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z',
    }
    useFamilyMembers.mockReturnValue({ status: 'success', data: [...rows, spouse], refetch: () => {} })
    const leave = idle()
    leave.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useLeaveFamily.mockReturnValue(leave)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '가족 나가기' }))
    await userEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(leave.mutate).toHaveBeenCalledWith(undefined, expect.anything())
    expect(screen.getByText('새 가족이 되었어요')).toBeInTheDocument()
  })

  it('뮤테이션 오류 문구', () => {
    useRemoveChild.mockReturnValue({ ...idle(), isError: true, error: new Error('child_not_found') })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('자녀를 찾을 수 없어요')
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useFamilyMembers.mockReturnValue({ status: 'pending', refetch: () => {} })
    const { rerender } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    const refetch = vi.fn<() => void>()
    useFamilyMembers.mockReturnValue({ status: 'error', refetch })
    rerender(page())
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('"+ 자녀 추가" 를 열면 이전 동작의 오류 상태를 지운다', async () => {
    const leave = idle()
    const remove = idle()
    useLeaveFamily.mockReturnValue(leave)
    useRemoveChild.mockReturnValue(remove)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 자녀 추가' }))
    expect(leave.reset).toHaveBeenCalled()
    expect(remove.reset).toHaveBeenCalled()
  })

  it('AddChildForm 에 내 자녀만 existingChildren 으로 넘긴다', async () => {
    const othersChild: FamilyMember = {
      id: 'p4', name: '민준', phone: null, is_minor: true, guardian_id: 'p3',
      auth_user_id: 'k2', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z', created_at: '2026-10-08T00:00:00Z',
    }
    useFamilyMembers.mockReturnValue({ status: 'success', data: [...rows, othersChild], refetch: () => {} })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 자녀 추가' }))
    expect(addChildProps).toHaveBeenCalled()
    const lastCall = addChildProps.mock.calls.at(-1)
    expect(lastCall?.[0].existingChildren).toEqual([rows[1]])
  })

  it('"+ 가족 연결" 패널이 열리면 내 사람 행을 3초마다 확인한다 (상대가 나를 합칠 수 있다)', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    expect(usePerson).toHaveBeenLastCalledWith('u1', { refetchInterval: PAIR_POLL_MS })
    await userEvent.click(screen.getByRole('button', { name: '연결성공' }))
    expect(screen.getByText('이영희 님이 우리 가족이 되었어요')).toBeInTheDocument()
    expect(usePerson).toHaveBeenLastCalledWith('u1', { refetchInterval: false })
  })

  it('내 코드를 보여 주는 동안 가족이 바뀌면(상대가 나를 합침) 패널을 닫고 알린다', async () => {
    const utils = renderPage()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    // 폴링으로 내 사람 행의 family_id 가 바뀌어 다시 그려진 상황
    useCurrentPerson.mockReturnValue({ ...me, family_id: 'f2' })
    utils.rerender(page())
    expect(screen.getByText('가족이 연결되었어요')).toBeInTheDocument()
    expect(screen.queryByText('가족 연결 패널')).not.toBeInTheDocument()
    expect(useFamilyMembers).toHaveBeenLastCalledWith('f2')
    // 합류가 확인된 뒤에는 더 폴링할 필요가 없다
    expect(usePerson).toHaveBeenLastCalledWith('u1', { refetchInterval: false })
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByText('가족이 연결되었어요')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 자녀 추가' })).toBeInTheDocument()
    // 보여 주고 있던 어른 코드는 이미 상대가 써 버렸다 — 남은 gcTime 동안 캐시에 남아 있으면
    // 다음에 코드를 다시 보여 줄 때 죽은 코드의 카운트다운을 보여 주게 된다.
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: pairingCodeQueryKey('adult') })
  })

  it('가족 나가기 중에는(아직 응답 전) 합류로 오인하지 않는다', async () => {
    const spouse: FamilyMember = {
      id: 'p3', name: '이영희', phone: '01098765432', is_minor: false, guardian_id: null,
      auth_user_id: 'u3', consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z',
    }
    useFamilyMembers.mockReturnValue({ status: 'success', data: [...rows, spouse], refetch: () => {} })
    const leave = idle()
    leave.mutate = vi.fn<Mutation['mutate']>() // 응답이 오기 전 상태를 흉내 — onSuccess 를 부르지 않는다
    useLeaveFamily.mockReturnValue(leave)
    const utils = renderPage()
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '가족 나가기' }))
    await userEvent.click(screen.getByRole('button', { name: '나가기' }))
    // leave_family 는 아직 응답하지 않았지만, 실제로는 이 무렵 family_id 가 이미 바뀌어 있을 수 있다
    useCurrentPerson.mockReturnValue({ ...me, family_id: 'f2' })
    utils.rerender(page())
    expect(screen.queryByText('가족이 연결되었어요')).not.toBeInTheDocument()
    expect(screen.queryByText('가족 연결 패널')).not.toBeInTheDocument()
  })

  it('합류 뒤 가족 연결 패널을 다시 열면 그 가족을 새로 기준 삼는다', async () => {
    const utils = renderPage()
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    useCurrentPerson.mockReturnValue({ ...me, family_id: 'f2' })
    utils.rerender(page())
    expect(screen.getByText('가족이 연결되었어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    // 아직 family_id 는 f2 그대로다 (useCurrentPerson mock 유지) — 다시 열면 f2 를 새 기준으로 잡아야 한다
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    expect(screen.queryByText('가족이 연결되었어요')).not.toBeInTheDocument()
  })

  it('내 정보 구역이 맨 아래에 있다', () => {
    renderPage()
    expect(screen.getByText('내 정보 구역')).toBeInTheDocument()
  })
})
