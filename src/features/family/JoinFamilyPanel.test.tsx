import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinFamilyPanel } from './JoinFamilyPanel'

type Mutation = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: (row: { name: string }) => void }) => void }
const { useJoinFamily } = vi.hoisted(() => ({ useJoinFamily: vi.fn<() => Mutation>() }))
vi.mock('./useFamilyActions', () => ({ useJoinFamily }))
vi.mock('../pairing/PairingCodeCard', () => ({ PairingCodeCard: ({ kind, hint }: { kind: string; hint: string }) => <p>card:{kind}:{hint}</p> }))

const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })

function renderPanel() {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<JoinFamilyPanel onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('JoinFamilyPanel', () => {
  it('기본은 상대 코드 입력 — 8자리를 넣으면 add_family_member, 성공하면 onDone', async () => {
    const join = idle()
    join.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '이영희' }))
    useJoinFamily.mockReturnValue(join)
    const { onDone } = renderPanel()
    expect(screen.getByRole('radio', { name: '상대 코드 입력' })).toBeChecked()
    await userEvent.type(screen.getByLabelText('상대 폰에 뜬 코드'), '0000 1111')
    await userEvent.click(screen.getByRole('button', { name: '우리 가족으로 연결' }))
    expect(join.mutate).toHaveBeenCalledWith({ code: '00001111' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('이영희 님이 우리 가족이 되었어요')
  })

  it('코드가 틀리면 칸에 오류, 서버 오류는 문구', async () => {
    useJoinFamily.mockReturnValue({ ...idle(), isError: true, error: new Error('invalid_code') })
    renderPanel()
    await userEvent.type(screen.getByLabelText('상대 폰에 뜬 코드'), '1')
    await userEvent.click(screen.getByRole('button', { name: '우리 가족으로 연결' }))
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual(expect.arrayContaining([expect.stringContaining('8자리 숫자'), expect.stringContaining('코드가 맞지 않거나')]))
  })

  it('"내 코드 보여 주기" 로 바꾸면 어른 코드 카드', async () => {
    useJoinFamily.mockReturnValue(idle())
    const { onCancel } = renderPanel()
    await userEvent.click(screen.getByRole('radio', { name: '내 코드 보여 주기' }))
    expect(screen.getByText(/card:adult:/)).toBeInTheDocument()
    expect(screen.queryByLabelText('상대 폰에 뜬 코드')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
