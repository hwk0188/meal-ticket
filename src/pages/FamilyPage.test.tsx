import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import type { FamilyMember } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { FamilyPage } from './FamilyPage'

type Query = { status: 'pending' | 'error' | 'success'; data?: FamilyMember[]; refetch: () => void }
type Mutation = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void }
const { useCurrentPerson, useAuth, usePerson, useFamilyMembers, useLeaveFamily, useRemoveChild } = vi.hoisted(() => ({
  useCurrentPerson: vi.fn<() => Person>(),
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string } } }>(),
  usePerson: vi.fn<(userId: string | undefined, options?: { refetchInterval?: number | false }) => unknown>(),
  useFamilyMembers: vi.fn<() => Query>(),
  useLeaveFamily: vi.fn<() => Mutation>(),
  useRemoveChild: vi.fn<() => Mutation>(),
}))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson, usePerson }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/family/useFamilyMembers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/family/useFamilyMembers')>()),
  useFamilyMembers,
}))
vi.mock('../features/family/useFamilyActions', () => ({ useLeaveFamily, useRemoveChild }))
vi.mock('../features/family/AddChildForm', () => ({
  AddChildForm: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>자녀 추가 폼</p>
      <button type="button" onClick={() => onDone('서연 님을 연결했어요')}>폼성공</button>
      <button type="button" onClick={onCancel}>폼취소</button>
    </div>
  ),
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
const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })

function renderPage() {
  return render(<MemoryRouter><FamilyPage /></MemoryRouter>)
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
    expect(screen.getByRole('status')).toHaveTextContent('서연 님을 연결했어요')
  })

  it('자녀 삭제 확인 → remove_child 뮤테이션', async () => {
    const remove = idle()
    remove.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useRemoveChild.mockReturnValue(remove)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(remove.mutate).toHaveBeenCalledWith('p2', expect.anything())
    expect(screen.getByRole('status')).toHaveTextContent('서연 을(를) 삭제했어요')
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
    rerender(<MemoryRouter><FamilyPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('PAIR_POLL_MS 는 연결 코드 화면과 같은 값', () => {
    expect(PAIR_POLL_MS).toBe(3_000)
  })
})
