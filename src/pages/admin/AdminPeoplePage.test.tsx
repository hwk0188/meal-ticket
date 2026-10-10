import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { decoratePeople, type DecoratedPerson, type PersonRow } from '../../features/admin/peopleFilter'
import { AdminPeoplePage } from './AdminPeoplePage'

type Q = { status: 'pending' | 'error' | 'success'; data?: DecoratedPerson[]; refetch: () => void }
const { useAllPeople } = vi.hoisted(() => ({ useAllPeople: vi.fn<() => Q>() }))
vi.mock('../../features/admin/useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useAllPeople')>()),
  useAllPeople,
}))

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const people = decoratePeople([
  row({ id: 'p1' }),
  row({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
  row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f2', role: 'admin' }),
  row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f3', auth_user_id: null }),
])

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/people']}>
      <Routes>
        <Route path="/admin/people" element={<AdminPeoplePage />} />
        <Route path="/admin/people/:personId" element={<p>사람 상세</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useAllPeople.mockReturnValue({ status: 'success', data: people, refetch: vi.fn<() => void>() })
})

describe('AdminPeoplePage', () => {
  it('머리말·인원수, 이름 순 목록, 전체 번호와 태그', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: '사람' })).toBeInTheDocument()
    expect(screen.getByText('4명')).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: '사람 목록' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('권사'),
      expect.stringContaining('김철수'),
      expect.stringContaining('서연'),
      expect.stringContaining('이순자'),
    ])
    // 전체 번호는 관리자 화면에서만 보인다 (설계 §10)
    expect(items[1]).toHaveTextContent('010-1234-5678')
    expect(items[0]).toHaveTextContent('관리자')
    expect(items[2]).toHaveTextContent('자녀')
    expect(items[3]).toHaveTextContent('미가입')
    // 가족이 둘 이상이면 가족 수를 보여 준다
    expect(items[1]).toHaveTextContent('가족 2명')
  })

  it('번호가 없는 사람은 "번호 없음"', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /서연/ })).toHaveTextContent('번호 없음')
  })

  it('검색하면 좁혀지고, 없으면 안내', async () => {
    renderPage()
    const box = screen.getByLabelText('이름 또는 번호 뒷자리')
    await userEvent.type(box, '1111')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1명')).toBeInTheDocument()
    await userEvent.clear(box)
    await userEvent.type(box, '없는사람')
    expect(screen.getByText('찾는 사람이 없어요')).toBeInTheDocument()
  })

  it('필터 칩으로 미가입·관리자만 볼 수 있다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: '미가입' }))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('이순자')])
    await userEvent.click(screen.getByRole('radio', { name: '관리자' }))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('권사')])
    await userEvent.click(screen.getByRole('radio', { name: '전체' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('이름을 누르면 상세로 간다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: /김철수/ }))
    expect(screen.getByText('사람 상세')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useAllPeople.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    useAllPeople.mockReturnValue({ status: 'error', refetch })
    rerender(
      <MemoryRouter initialEntries={['/admin/people']}>
        <Routes>
          <Route path="/admin/people" element={<AdminPeoplePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다', () => {
    useAllPeople.mockReturnValue({ status: 'error', data: people, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 목록을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '사람 목록' })).toBeInTheDocument()
  })
})
