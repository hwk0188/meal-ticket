import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmButton } from './ConfirmButton'

/** onConfirm 이 (뮤테이션처럼) 같은 처리 중에 트리거를 비활성화하는 호출자를 흉내 낸다. */
function DisablingDuringConfirm() {
  const [disabled, setDisabled] = useState(false)
  return (
    <>
      <ConfirmButton label="탈퇴" message="정말요?" disabled={disabled} onConfirm={() => setDisabled(true)} />
      <button type="button" onClick={() => setDisabled(false)}>처리 완료</button>
    </>
  )
}

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
    // 확인을 눌러도(onConfirm 이 버튼을 비활성화하지 않는 한) 포커스는 트리거로 돌아간다
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '자녀 삭제' }))
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

  it('프롬프트가 열리면 취소로 포커스를 옮기고, 취소하면 트리거로 되돌린다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '탈퇴' }))
  })

  it('열린 채로 disabled 가 되면 닫힌다', async () => {
    const onConfirm = vi.fn<() => void>()
    const { rerender } = render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} disabled />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탈퇴' })).toBeDisabled()
  })

  it('열린 채로 disabled 가 되어 강제로 닫히면, 트리거가 다시 활성화될 때 포커스를 되돌린다', async () => {
    const onConfirm = vi.fn<() => void>()
    const { rerender } = render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))

    rerender(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} disabled />)
    // 아직 비활성이다 — 비활성 버튼에 포커스를 걸어 봐야 소용없으니 미뤄 둔다.
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '탈퇴' }))

    rerender(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} disabled={false} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '탈퇴' }))
  })

  it('context 를 주면 접근성 이름 앞에 붙지만 눈에 보이는 글자는 그대로다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="자녀 삭제" message="되돌릴 수 없어요" confirmLabel="삭제" context="서연" onConfirm={onConfirm} />)
    const trigger = screen.getByRole('button', { name: '서연 자녀 삭제' })
    expect(trigger).toHaveTextContent('자녀 삭제')
    await userEvent.click(trigger)
    expect(screen.getByRole('group', { name: '서연 자녀 삭제' })).toBeInTheDocument()
  })

  it('확인이 트리거를 비활성화하는 처리라면, 처리가 끝나 다시 활성화될 때 포커스를 되돌린다', async () => {
    render(<DisablingDuringConfirm />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    // 트리거가 비활성인 동안은(처리 중) 포커스를 돌려받지 못한다.
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '탈퇴' }))

    // 처리가 끝나 다시 활성화되면 그제야 포커스가 돌아온다.
    await userEvent.click(screen.getByRole('button', { name: '처리 완료' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '탈퇴' }))
  })
})
