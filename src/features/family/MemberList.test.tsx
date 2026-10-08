import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberList } from './MemberList'
import type { FamilyMember } from './useFamilyMembers'

const member = (over: Partial<FamilyMember>): FamilyMember => ({
  id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1',
  consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const me = member({})
const spouse = member({ id: 'p3', name: '이영희', phone: '01098765432', auth_user_id: 'u3' })
const myChild = member({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z' })
const spouseChild = member({ id: 'p4', name: '민준', phone: null, is_minor: true, guardian_id: 'p3', auth_user_id: 'k2', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z' })
const visitor = member({ id: 'p5', name: '이순자', phone: '01011112222', auth_user_id: null, consented_at: null })

function renderList(members: FamilyMember[], over: Partial<Parameters<typeof MemberList>[0]> = {}) {
  const onLeave = vi.fn<() => void>()
  const onRemoveChild = vi.fn<(c: FamilyMember) => void>()
  render(<MemberList members={members} me={me} pending={false} onLeave={onLeave} onRemoveChild={onRemoveChild} {...over} />)
  return { onLeave, onRemoveChild }
}

describe('MemberList', () => {
  it('이름·태그·가려진 번호·동의 날짜를 보여 준다', () => {
    renderList([me, spouse, myChild, visitor])
    const rows = within(screen.getByRole('list', { name: '가족 구성원' })).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('김철수')
    expect(rows[0]).toHaveTextContent('나')
    expect(rows[0]).toHaveTextContent('010-****-5678')
    expect(rows[0]).toHaveTextContent('동의 10/7')
    expect(rows[2]).toHaveTextContent('서연')
    expect(rows[2]).toHaveTextContent('자녀')
    expect(rows[2]).toHaveTextContent('보호자 동의 10/5')
    expect(rows[3]).toHaveTextContent('미가입')
  })

  it('나와 내 자녀뿐이면 "가족 나가기" 가 없다', () => {
    renderList([me, myChild])
    expect(screen.queryByRole('button', { name: '가족 나가기' })).not.toBeInTheDocument()
  })

  it('다른 어른이 있으면 내 행에 "가족 나가기" — 확인을 거쳐 onLeave', async () => {
    const { onLeave } = renderList([me, spouse])
    await userEvent.click(screen.getByRole('button', { name: '가족 나가기' }))
    expect(onLeave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('내 자녀 행에만 "자녀 삭제" — 확인을 거쳐 onRemoveChild(자녀)', async () => {
    const { onRemoveChild } = renderList([me, myChild, spouseChild])
    expect(screen.getAllByRole('button', { name: '자녀 삭제' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onRemoveChild).toHaveBeenCalledWith(myChild)
  })

  it('처리 중에는 버튼을 잠그고 라벨을 "처리 중…" 으로 바꾼다', () => {
    renderList([me, spouse, myChild], { pending: true })
    // 가족 나가기·자녀 삭제 두 버튼 모두 (ConfirmButton 계약 — Task 6 리뷰)
    const busy = screen.getAllByRole('button', { name: '처리 중…' })
    expect(busy).toHaveLength(2)
    for (const b of busy) expect(b).toBeDisabled()
    expect(screen.queryByRole('button', { name: '가족 나가기' })).not.toBeInTheDocument()
  })
})
