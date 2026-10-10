import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../auth/usePerson'
import { PersonDangerZone } from './PersonDangerZone'

type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars?: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useResetPerson, useLinkPerson } = vi.hoisted(() => ({
  useResetPerson: vi.fn<(id: string) => M>(),
  useLinkPerson: vi.fn<(id: string) => M>(),
}))
vi.mock('./usePersonOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePersonOps')>()),
  useResetPerson,
  useLinkPerson,
}))

const PID = '00000000-0000-4000-8000-000000000001'
const base = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: null, role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderZone(person: Person = base, extra: { editing?: boolean; onStart?: () => void } = {}) {
  const onDone = vi.fn<(m: string) => void>()
  const utils = render(<PersonDangerZone person={person} onDone={onDone} {...extra} />)
  return { onDone, ...utils }
}

beforeEach(() => {
  useResetPerson.mockReturnValue(idle())
  useLinkPerson.mockReturnValue(idle())
})

describe('PersonDangerZone · 초기화', () => {
  it('확인을 거쳐 초기화하고 안내가 뜬다 — 확인 문구에 대상 이름·번호가 적힌다', async () => {
    const reset = idle()
    reset.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useResetPerson.mockReturnValue(reset)
    const { onDone } = renderZone()
    // 트리거 버튼의 접근성 이름에도 대상 이름이 sr-only 로 붙는다 — 같은 라벨의 버튼이 여러 사람 화면에 있어도 구분된다
    await userEvent.click(screen.getByRole('button', { name: '김철수 사람 초기화' }))
    expect(screen.getByRole('status')).toHaveTextContent('김철수(010-1234-5678) 님을 초기화할까요?')
    expect(screen.getByRole('status')).toHaveTextContent('이름·번호를 지우고 카카오 연결을 끊어요')
    expect(reset.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(reset.mutate).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith('김철수 님을 초기화했어요')
  })

  it('번호가 없으면 확인 문구에 "번호 없음" 이라고 적는다', async () => {
    renderZone({ ...base, phone: null })
    await userEvent.click(screen.getByRole('button', { name: '김철수 사람 초기화' }))
    expect(screen.getByRole('status')).toHaveTextContent('김철수(번호 없음) 님을 초기화할까요?')
  })

  it('마지막 관리자 오류는 초기화 맥락 문구로', () => {
    useResetPerson.mockReturnValue({ ...idle(), isError: true, error: new Error('last_admin') })
    renderZone()
    expect(screen.getByRole('alert')).toHaveTextContent('마지막 관리자는 초기화할 수 없어요')
  })

  it('초기화를 시작하면 onStart 를 불러 페이지의 지난 알림을 지운다', async () => {
    const reset = idle()
    useResetPerson.mockReturnValue(reset)
    const onStart = vi.fn<() => void>()
    renderZone(base, { onStart })
    await userEvent.click(screen.getByRole('button', { name: '김철수 사람 초기화' }))
    await userEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('초기화를 시작하면 연결 오류도 지운다 (서로의 오류를 지운다)', async () => {
    const link = { ...idle(), isError: true, error: new Error('consent_required') }
    useLinkPerson.mockReturnValue(link)
    const reset = idle()
    useResetPerson.mockReturnValue(reset)
    renderZone()
    await userEvent.click(screen.getByRole('button', { name: '김철수 사람 초기화' }))
    await userEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(link.reset).toHaveBeenCalled()
  })
})

describe('PersonDangerZone · 계정 연결', () => {
  it('계정이 없는 사람에게만 보인다', () => {
    renderZone({ ...base, auth_user_id: 'u1' })
    expect(screen.queryByRole('button', { name: '계정 연결' })).not.toBeInTheDocument()
    expect(screen.getByText('카카오 계정이 연결돼 있어요')).toBeInTheDocument()
  })

  it('uuid 를 넣어야 부른다', async () => {
    const link = idle()
    link.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useLinkPerson.mockReturnValue(link)
    const { onDone } = renderZone()
    await userEvent.click(screen.getByRole('button', { name: '계정 연결' }))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(link.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('계정 id(uuid)를 붙여 넣어 주세요')
    await userEvent.clear(screen.getByLabelText('카카오 계정 id'))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), '123e4567-e89b-42d3-a456-426614174000')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(link.mutate).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000', expect.anything())
    expect(onDone).toHaveBeenCalledWith('카카오 계정을 연결했어요')
  })

  it('동의 기록이 없는 사람은 연결 칸 대신 이유를 보여 준다', async () => {
    renderZone({ ...base, consented_at: null, consent_version: null })
    expect(screen.queryByRole('button', { name: '계정 연결' })).not.toBeInTheDocument()
    expect(screen.getByText('동의 기록이 없어 연결할 수 없어요. 본인이 가입 화면에서 동의해야 해요.')).toBeInTheDocument()
  })

  it('연결 폼의 "그만두기" 는 합치기 패널의 "그만두기" 와 접근성 이름이 다르다', async () => {
    renderZone()
    await userEvent.click(screen.getByRole('button', { name: '계정 연결' }))
    expect(screen.getByRole('button', { name: '계정 연결 그만두기' })).toBeInTheDocument()
  })

  it('연결을 시작하면 onStart 를 불러 페이지의 지난 알림을 지운다', async () => {
    const link = idle()
    link.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useLinkPerson.mockReturnValue(link)
    const onStart = vi.fn<() => void>()
    renderZone(base, { onStart })
    await userEvent.click(screen.getByRole('button', { name: '계정 연결' }))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), '123e4567-e89b-42d3-a456-426614174000')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('연결을 시작하면 초기화 오류도 지운다 (서로의 오류를 지운다)', async () => {
    const reset = { ...idle(), isError: true, error: new Error('last_admin') }
    useResetPerson.mockReturnValue(reset)
    const link = idle()
    link.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useLinkPerson.mockReturnValue(link)
    renderZone()
    await userEvent.click(screen.getByRole('button', { name: '계정 연결' }))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), '123e4567-e89b-42d3-a456-426614174000')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(reset.reset).toHaveBeenCalled()
  })
})

describe('PersonDangerZone · 수정 폼이 열리면', () => {
  it('초기화·연결의 지난 오류를 지운다', () => {
    const reset = { ...idle(), isError: true, error: new Error('last_admin') }
    const link = { ...idle(), isError: true, error: new Error('consent_required') }
    useResetPerson.mockReturnValue(reset)
    useLinkPerson.mockReturnValue(link)
    const { rerender } = renderZone(base, { editing: false })
    expect(reset.reset).not.toHaveBeenCalled()
    rerender(<PersonDangerZone person={base} onDone={vi.fn<(m: string) => void>()} editing={true} />)
    expect(reset.reset).toHaveBeenCalled()
    expect(link.reset).toHaveBeenCalled()
  })
})
