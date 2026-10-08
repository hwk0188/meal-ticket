import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../auth/usePerson'
import { ProfileSection } from './ProfileSection'

type Mutation = { isPending: boolean; isError: boolean; error?: Error; data?: { signedOut: boolean }; mutate: (vars?: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useUpdateProfile, useDeleteAccount } = vi.hoisted(() => ({
  useUpdateProfile: vi.fn<() => Mutation>(),
  useDeleteAccount: vi.fn<() => Mutation>(),
}))
vi.mock('./useFamilyActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useFamilyActions')>()),
  useUpdateProfile,
  useDeleteAccount,
}))

const me = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>(), reset: vi.fn<() => void>() })

describe('ProfileSection', () => {
  beforeEach(() => {
    useUpdateProfile.mockReturnValue(idle())
    useDeleteAccount.mockReturnValue(idle())
  })

  it('이름·가려진 번호와 수정·탈퇴 버튼', () => {
    render(<ProfileSection me={me} />)
    expect(screen.getByText('김철수 · 010-****-5678')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탈퇴' })).toBeInTheDocument()
  })

  it('수정 → 폼(현재 값 채워짐) → 저장하면 update, 성공하면 닫힌다', async () => {
    const update = idle()
    update.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdateProfile.mockReturnValue(update)
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('010-1234-5678')
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-9999-8888')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수', phone: '01099998888' }, expect.anything())
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
  })

  it('틀린 번호는 서버를 부르지 않고 칸에 오류, 취소하면 원래 값으로', async () => {
    const update = idle()
    useUpdateProfile.mockReturnValue(update)
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByText('김철수 · 010-****-5678')).toBeInTheDocument()
    expect(update.reset).toHaveBeenCalled()
  })

  it('번호 중복(23505) 서버 오류 문구', async () => {
    useUpdateProfile.mockReturnValue({ ...idle(), isError: true, error: Object.assign(new Error('duplicate'), { code: '23505' }) })
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 분이 쓰는 번호예요')
  })

  it('탈퇴 뒤 로그아웃만 실패하면(signedOut=false) 앱을 다시 열라고 안내한다', () => {
    useDeleteAccount.mockReturnValue({ ...idle(), data: { signedOut: false } })
    render(<ProfileSection me={me} />)
    expect(screen.getByRole('alert')).toHaveTextContent('앱을 닫고 다시 열어 주세요')
  })

  it('탈퇴는 확인을 거쳐 delete_my_account, has_children 이면 문구', async () => {
    const del = idle()
    useDeleteAccount.mockReturnValue(del)
    const { rerender } = render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    expect(screen.getByRole('status')).toHaveTextContent('익명 처리')
    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
    expect(del.mutate).toHaveBeenCalledOnce()
    useDeleteAccount.mockReturnValue({ ...idle(), isError: true, error: new Error('has_children') })
    rerender(<ProfileSection me={me} />)
    expect(screen.getByRole('alert')).toHaveTextContent('자녀를 먼저 삭제해 주세요')
  })
})
