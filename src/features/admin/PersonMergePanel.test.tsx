import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decoratePeople, type DecoratedPerson, type PersonRow } from './peopleFilter'
import type { Person } from '../auth/usePerson'
import { PersonMergePanel } from './PersonMergePanel'

type Q = { status: 'pending' | 'error' | 'success'; data?: DecoratedPerson[]; refetch: () => void }
type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: string, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useAllPeople, useMergePeople } = vi.hoisted(() => ({
  useAllPeople: vi.fn<() => Q>(),
  useMergePeople: vi.fn<(intoId: string) => M>(),
}))
vi.mock('./useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useAllPeople')>()),
  useAllPeople,
}))
vi.mock('./usePersonOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePersonOps')>()),
  useMergePeople,
}))

const PID = '00000000-0000-4000-8000-000000000001'
const me = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: null, role: 'member',
  is_minor: false, guardian_id: null, consented_at: null, consent_version: null,
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p9', family_id: 'f9', name: '김철수', phone: '01088887777', auth_user_id: null,
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const candidates = decoratePeople([
  row({ id: PID, family_id: 'f1', phone: '01012345678' }), // 본인
  row({ id: 'p9' }),                                        // 합칠 중복 행 (계정 없음)
  row({ id: 'p8', name: '이영희', phone: '01099998888', auth_user_id: 'u8', family_id: 'f8' }), // 계정 있음
  row({ id: 'p7', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k7', family_id: 'f1' }), // 자녀
])
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderPanel(person: Person = me) {
  const onDone = vi.fn<(m: string) => void>()
  render(<PersonMergePanel person={person} onDone={onDone} />)
  return { onDone }
}

beforeEach(() => {
  useAllPeople.mockReturnValue({ status: 'success', data: candidates, refetch: vi.fn<() => void>() })
  useMergePeople.mockReturnValue(idle())
})

describe('PersonMergePanel', () => {
  it('접혀 있고, 열면 검색 칸이 나온다', async () => {
    renderPanel()
    expect(screen.queryByLabelText('합칠 사람 찾기')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByLabelText('합칠 사람 찾기')).toBeInTheDocument()
    expect(useMergePeople).toHaveBeenCalledWith(PID)
  })

  it('본인과 자녀는 후보에서 빠진다', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '010')
    const names = within(screen.getByRole('list', { name: '합칠 사람 후보' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toEqual([expect.stringContaining('김철수'), expect.stringContaining('이영희')])
    expect(names.join()).not.toContain('서연')
  })

  it('두 글자 미만이면 후보를 띄우지 않는다 (전체 명단이 쏟아지지 않게)', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByText('두 글자 또는 번호 뒷자리를 넣어 주세요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '합칠 사람 후보' })).not.toBeInTheDocument()
  })

  it('둘 다 계정이 있으면 그 후보는 잠기고 이유를 보여 준다', async () => {
    renderPanel({ ...me, auth_user_id: 'u1', consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07' })
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '이영희')
    expect(screen.getByRole('button', { name: /이영희 선택/ })).toBeDisabled()
    expect(screen.getByText('둘 다 카카오 계정이 있어요 — 한쪽을 먼저 초기화해 주세요')).toBeInTheDocument()
  })

  it('후보를 고르면 방향이 분명한 확인을 거쳐 merge 를 부른다', async () => {
    const merge = idle()
    merge.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useMergePeople.mockReturnValue(merge)
    const { onDone } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '8888')
    await userEvent.click(screen.getByRole('button', { name: /김철수 선택/ }))
    expect(screen.getByText(/김철수\(010-8888-7777\) 의 기록·자녀·계정을 김철수\(010-1234-5678\) 로 옮기고/)).toBeInTheDocument()
    expect(merge.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '합치기' }))
    expect(merge.mutate).toHaveBeenCalledWith('p9', expect.anything())
    expect(onDone).toHaveBeenCalledWith('김철수 님으로 합쳤어요')
  })

  it('서버 오류 문구를 사람 관리 맥락으로 보여 준다', async () => {
    useMergePeople.mockReturnValue({ ...idle(), isError: true, error: new Error('both_have_accounts') })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('두 분 모두 카카오 계정이 있어요')
  })
})
