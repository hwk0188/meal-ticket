import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignOutButton } from './SignOutButton'

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>() }))
vi.mock('../features/auth/signIn', () => ({ signOut }))

describe('SignOutButton', () => {
  it('누르면 로그아웃하고, 성공 뒤에도 잠근 채 둔다 (Gate 가 화면을 바꿀 때까지)', async () => {
    signOut.mockResolvedValue(undefined)
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledOnce()
    await waitFor(() => expect(button).toBeDisabled())

    // 잠긴 버튼을 또 눌러도(더블 탭 등) 두 번째 로그아웃은 나가지 않는다.
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('실패하면 안내 문구를 띄우고 버튼을 다시 연다', async () => {
    signOut.mockRejectedValue(new Error('boom'))
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
    expect(button).not.toBeDisabled()
  })

  it('로그아웃 중에는 두 번 호출되지 않는다', async () => {
    let settle: () => void = () => {}
    signOut.mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    await act(async () => {
      settle()
    })
  })

  it('확인 문구가 있으면(아이 계정) 한 번 더 묻는다', async () => {
    signOut.mockResolvedValue(undefined)
    render(<SignOutButton message="아이 계정은 다시 연결해야 해요" />)
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('아이 계정은 다시 연결해야 해요')
    await userEvent.click(screen.getByRole('button', { name: '네, 로그아웃' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})
