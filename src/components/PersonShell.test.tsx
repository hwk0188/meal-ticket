import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import { PersonShell } from './PersonShell'

const member = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const admin = { ...member, id: 'p9', role: 'admin' } satisfies Person

function renderShell(person: Person, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PersonShell person={person}><p>내용</p></PersonShell>
    </MemoryRouter>,
  )
}

describe('PersonShell', () => {
  it('교인에게는 식권·내역 탭만', () => {
    renderShell(member, '/')
    expect(screen.getByText('내용')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역'])
  })

  it('관리자에게는 교인 화면에서 관리 탭이 하나 더 보인다', () => {
    renderShell(admin, '/')
    expect(screen.getByRole('link', { name: '관리' })).toHaveAttribute('href', '/admin/meals')
  })

  it('관리자 영역에서는 식사·발급·내 식권 탭', () => {
    renderShell(admin, '/admin/issue')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🍚식사', '🎟️발급', '🎫내 식권'])
  })

  it('교인이 관리자 주소로 바로 들어와도 교인 탭 그대로 (RequireAdmin 이 곧 돌려보낸다)', () => {
    renderShell(member, '/admin/meals')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역'])
  })
})
