import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddChildForm } from './AddChildForm'
import type { FamilyMember } from './useFamilyMembers'

type Mutation = {
  isPending: boolean
  isError: boolean
  error?: Error
  mutate: (vars: unknown, opts?: { onSuccess?: (row: { name: string }) => void }) => void
}
const { useAddChild, useRelinkChild } = vi.hoisted(() => ({
  useAddChild: vi.fn<() => Mutation>(),
  useRelinkChild: vi.fn<() => Mutation>(),
}))
vi.mock('./useFamilyActions', () => ({ useAddChild, useRelinkChild }))

const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })
const existing: FamilyMember[] = [{
  id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1',
  consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z', created_at: '2026-10-05T00:00:00Z',
}]

function renderForm(existingChildren: FamilyMember[] = []) {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<AddChildForm existingChildren={existingChildren} onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('AddChildForm · 새 자녀', () => {
  it('동의 전에는 연결 버튼이 잠긴다', () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
    expect(screen.getByText(/보호자로서 동의합니다/)).toBeInTheDocument()
  })

  it('이름·코드·동의로 add 를 부르고, 성공하면 onDone', async () => {
    const add = idle()
    add.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '서연' }))
    useAddChild.mockReturnValue(add)
    useRelinkChild.mockReturnValue(idle())
    const { onDone } = renderForm()
    await userEvent.type(screen.getByLabelText('자녀 이름'), '서연')
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '4829 1357')
    await userEvent.click(screen.getByLabelText(/법정대리인 동의/))
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(add.mutate).toHaveBeenCalledWith({ name: '서연', code: '48291357' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('서연 님을 연결했어요')
  })

  it('코드가 틀리면 서버를 부르지 않고 칸에 오류', async () => {
    const add = idle()
    useAddChild.mockReturnValue(add)
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    await userEvent.type(screen.getByLabelText('자녀 이름'), '서연')
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '12')
    await userEvent.click(screen.getByLabelText(/법정대리인 동의/))
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(add.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('8자리 숫자 코드를 입력해 주세요')
  })

  it('서버 오류 문구를 보여 준다', () => {
    useAddChild.mockReturnValue({ ...idle(), isError: true, error: new Error('invalid_code') })
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    expect(screen.getByRole('alert')).toHaveTextContent('코드가 맞지 않거나 만료되었어요')
  })

  it('취소 버튼은 onCancel', async () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    const { onCancel } = renderForm()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('AddChildForm · 기존 자녀 재연결', () => {
  it('자녀가 있으면 고를 수 있고, 고르면 이름·동의 없이 코드만으로 relink', async () => {
    const relink = idle()
    relink.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '서연' }))
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(relink)
    const { onDone } = renderForm(existing)
    await userEvent.selectOptions(screen.getByLabelText('자녀'), 'p2')
    expect(screen.queryByLabelText('자녀 이름')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/법정대리인 동의/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '11111111')
    await userEvent.click(screen.getByRole('button', { name: '다시 연결하기' }))
    expect(relink.mutate).toHaveBeenCalledWith({ childId: 'p2', code: '11111111' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('서연 님을 다시 연결했어요')
  })

  it('자녀가 없으면 고르는 칸이 없다', () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    renderForm([])
    expect(screen.queryByLabelText('자녀')).not.toBeInTheDocument()
  })
})
