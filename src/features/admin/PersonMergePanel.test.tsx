import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decoratePeople, type DecoratedPerson, type PersonRow } from './peopleFilter'
import type { Person } from '../auth/usePerson'
import { MAX_PEOPLE } from './useAllPeople'
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
// 서연은 번호가 있다(010 으로 시작) — 검색 '010' 이 자녀도 걸러내지 않고 그냥 매치시킨다.
// 그래야 결과에서 서연이 빠지는 것이 (검색이 아니라) "자녀는 후보가 아니다" 필터가 한 일임을 시험할 수 있다.
const rawPeople = [
  row({ id: PID, family_id: 'f1', phone: '01012345678' }), // 본인
  row({ id: 'p9' }),                                        // 합칠 중복 행 (계정 없음)
  row({ id: 'p8', name: '이영희', phone: '01099998888', auth_user_id: 'u8', family_id: 'f8' }), // 계정 있음
  row({ id: 'p7', name: '서연', phone: '01066665555', is_minor: true, guardian_id: PID, auth_user_id: 'k7', family_id: 'f1' }), // 자녀
]
const candidates = decoratePeople(rawPeople)
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderPanel(person: Person = me) {
  const onDone = vi.fn<(m: string) => void>()
  render(<PersonMergePanel person={person} onDone={onDone} />)
  return { onDone }
}

async function openAndSearch(text: string) {
  await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
  await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), text)
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

  it('본인과 자녀는 후보에서 빠진다 (검색은 걸리지만 필터가 뺀다)', async () => {
    renderPanel()
    await openAndSearch('010')
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
    await openAndSearch('이영희')
    expect(screen.getByRole('button', { name: '이영희(010-9999-8888 · 등록 10/7) 선택' })).toBeDisabled()
    expect(screen.getByText('둘 다 카카오 계정이 있어요 — 한쪽을 먼저 초기화해 주세요')).toBeInTheDocument()
  })

  it('후보만 계정이 있고 본인은 없으면 잠기지 않는다 (bothLinked 는 AND — 둘 다일 때만 잠긴다)', async () => {
    renderPanel() // me.auth_user_id === null
    await openAndSearch('이영희')
    expect(screen.getByRole('button', { name: '이영희(010-9999-8888 · 등록 10/7) 선택' })).not.toBeDisabled()
  })

  it('후보를 고르면 방향이 분명한 확인을 거쳐 merge 를 부른다', async () => {
    const merge = idle()
    merge.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useMergePeople.mockReturnValue(merge)
    const { onDone } = renderPanel()
    await openAndSearch('8888')
    await userEvent.click(screen.getByRole('button', { name: '김철수(010-8888-7777 · 등록 10/7) 선택' }))
    expect(screen.getByText(/김철수\(010-8888-7777 · 등록 10\/7\) 의 기록·자녀·계정을 김철수\(010-1234-5678\) 로 옮기고/)).toBeInTheDocument()
    expect(merge.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '합치기' }))
    expect(merge.mutate).toHaveBeenCalledWith('p9', expect.anything())
    expect(onDone).toHaveBeenCalledWith('김철수 님으로 합쳤어요')
  })

  it('합치기를 시작하면 onStart 를 불러 페이지의 지난 알림을 지운다', async () => {
    const merge = idle()
    useMergePeople.mockReturnValue(merge)
    const onStart = vi.fn<() => void>()
    const onDone = vi.fn<(m: string) => void>()
    render(<PersonMergePanel person={me} onDone={onDone} onStart={onStart} />)
    await openAndSearch('8888')
    await userEvent.click(screen.getByRole('button', { name: '김철수(010-8888-7777 · 등록 10/7) 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '합치기' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('"취소" 는 선택만 지우지 않고 오류도 지운다', async () => {
    const merge = { ...idle(), isError: true, error: new Error('person_not_found') }
    useMergePeople.mockReturnValue(merge)
    renderPanel()
    await openAndSearch('8888')
    await userEvent.click(screen.getByRole('button', { name: '김철수(010-8888-7777 · 등록 10/7) 선택' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '합치기 취소' }))
    expect(merge.reset).toHaveBeenCalled()
  })

  it('"취소" 의 접근성 이름은 "합치기 취소" (위험 구역의 "취소" 와 구분)', async () => {
    renderPanel()
    await openAndSearch('8888')
    await userEvent.click(screen.getByRole('button', { name: '김철수(010-8888-7777 · 등록 10/7) 선택' }))
    expect(screen.getByRole('button', { name: '합치기 취소' })).toBeInTheDocument()
  })

  it('"수정" 폼이 열리면(editing) 지난 합치기 오류를 지운다', () => {
    const merge = { ...idle(), isError: true, error: new Error('both_have_accounts') }
    useMergePeople.mockReturnValue(merge)
    const { rerender } = render(<PersonMergePanel person={me} onDone={vi.fn<(m: string) => void>()} editing={false} />)
    expect(merge.reset).not.toHaveBeenCalled()
    rerender(<PersonMergePanel person={me} onDone={vi.fn<(m: string) => void>()} editing={true} />)
    expect(merge.reset).toHaveBeenCalled()
  })

  it('번호 없는 동명이인도 후보 줄·선택 버튼·확인 문구에서 서로 다르게 보인다', async () => {
    const dup1 = row({ id: 'd1', name: '박영수', phone: null, family_id: 'fd1', created_at: '2026-10-01T00:00:00Z' })
    const dup2 = row({ id: 'd2', name: '박영수', phone: null, family_id: 'fd2', created_at: '2026-10-05T00:00:00Z' })
    useAllPeople.mockReturnValue({ status: 'success', data: decoratePeople([...rawPeople, dup1, dup2]), refetch: vi.fn<() => void>() })
    renderPanel()
    await openAndSearch('박영수')
    const rows = within(screen.getByRole('list', { name: '합칠 사람 후보' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual([expect.stringContaining('등록 10/1'), expect.stringContaining('등록 10/5')])
    expect(screen.getByRole('button', { name: '박영수(번호 없음 · 등록 10/1) 선택' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '박영수(번호 없음 · 등록 10/5) 선택' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '박영수(번호 없음 · 등록 10/1) 선택' }))
    expect(screen.getByText(/박영수\(번호 없음 · 등록 10\/1\) 의 기록·자녀·계정을 김철수\(010-1234-5678\) 로 옮기고/)).toBeInTheDocument()
  })

  it('목록 단계의 서버 오류 문구도 사람 관리 맥락으로 보여 준다', async () => {
    useMergePeople.mockReturnValue({ ...idle(), isError: true, error: new Error('both_have_accounts') })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('두 분 모두 카카오 계정이 있어요')
  })

  it('고른 뒤 확인 화면에서도 서버 오류 문구를 사람 관리 맥락으로 보여 준다 (M6: 오류는 고른 뒤에만 생길 수 있다)', async () => {
    useMergePeople.mockReturnValue({ ...idle(), isError: true, error: new Error('both_have_accounts') })
    renderPanel()
    await openAndSearch('8888')
    await userEvent.click(screen.getByRole('button', { name: '김철수(010-8888-7777 · 등록 10/7) 선택' }))
    expect(screen.getByRole('alert')).toHaveTextContent('두 분 모두 카카오 계정이 있어요')
  })

  it('사람 목록을 불러오지 못하면(실패) "중복이 없다" 가 아니라 못 불러왔다고 말한다', async () => {
    useAllPeople.mockReturnValue({ status: 'error', data: undefined, refetch: vi.fn<() => void>() })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('사람 목록을 불러오지 못해 후보를 찾을 수 없어요')
    expect(screen.queryByText('찾는 사람이 없어요')).not.toBeInTheDocument()
  })

  it('사람 목록을 불러오는 중이면 스피너를 보여 준다', async () => {
    useAllPeople.mockReturnValue({ status: 'pending', data: undefined, refetch: vi.fn<() => void>() })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    expect(screen.queryByText('찾는 사람이 없어요')).not.toBeInTheDocument()
  })

  it(`천장(${MAX_PEOPLE}명)에 닿으면 후보가 잘렸을 수 있다고 알린다`, async () => {
    const many = Array.from({ length: MAX_PEOPLE }, (_, i) => row({ id: `m${i}`, name: `사람${i}`, family_id: `f${i}` }))
    useAllPeople.mockReturnValue({ status: 'success', data: decoratePeople(many), refetch: vi.fn<() => void>() })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByText(`사람이 너무 많아 ${MAX_PEOPLE}명까지만 불러왔어요. 목록에 없는 분이 있을 수 있어요.`)).toBeInTheDocument()
  })
})
