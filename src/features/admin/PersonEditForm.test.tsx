import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonEditForm } from './PersonEditForm'

type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useUpdatePerson } = vi.hoisted(() => ({ useUpdatePerson: vi.fn<(personId: string) => M>() }))
vi.mock('./usePersonOps', () => ({ useUpdatePerson }))

const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderForm(over: { name?: string; phone?: string | null } = {}) {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<PersonEditForm personId="p1" name={over.name ?? '김철수'} phone={over.phone === undefined ? '01012345678' : over.phone} onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('PersonEditForm', () => {
  beforeEach(() => {
    useUpdatePerson.mockReturnValue(idle())
  })

  it('현재 값이 채워지고, 저장하면 정규화된 값으로 부른다', async () => {
    const update = idle()
    update.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdatePerson.mockReturnValue(update)
    const { onDone } = renderForm()
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('010-1234-5678')
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-9999-8888')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수', phone: '01099998888' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('김철수 님 정보를 저장했어요')
  })

  it('번호를 비우면 번호 없는 사람으로 저장한다', async () => {
    const update = idle()
    update.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdatePerson.mockReturnValue(update)
    renderForm({ phone: null })
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('이름'), '이')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수이', phone: null }, expect.anything())
  })

  it('틀린 번호는 서버를 부르지 않고 칸에 오류', async () => {
    const update = idle()
    useUpdatePerson.mockReturnValue(update)
    renderForm()
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
  })

  it('번호 중복(23505) 서버 오류 문구', () => {
    useUpdatePerson.mockReturnValue({ ...idle(), isError: true, error: Object.assign(new Error('duplicate'), { code: '23505' }) })
    renderForm()
    expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 분이 쓰는 번호예요')
  })

  it('취소는 onCancel 과 reset', async () => {
    const update = idle()
    useUpdatePerson.mockReturnValue(update)
    const { onCancel } = renderForm()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(update.reset).toHaveBeenCalled()
  })
})
