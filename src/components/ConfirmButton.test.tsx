import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmButton } from './ConfirmButton'

describe('ConfirmButton', () => {
  it('확인 문구가 없으면 바로 실행한다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="로그아웃" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('확인 문구가 있으면 한 번 더 묻고, 확인을 눌러야 실행한다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="자녀 삭제" message="되돌릴 수 없어요" confirmLabel="삭제" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('되돌릴 수 없어요')
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    // 실행 뒤에는 처음 모양으로 돌아간다
    expect(screen.getByRole('button', { name: '자녀 삭제' })).toBeInTheDocument()
  })

  it('취소하면 실행하지 않고 닫힌다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탈퇴' })).toBeInTheDocument()
  })

  it('disabled 면 열리지도 실행되지도 않는다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} disabled />)
    const button = screen.getByRole('button', { name: '탈퇴' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
