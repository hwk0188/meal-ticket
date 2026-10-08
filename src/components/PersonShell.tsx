import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import { TabBar, type TabItem } from './TabBar'

const MEMBER_TABS: readonly TabItem[] = [
  { to: '/', label: '식권', icon: '🎫' },
  { to: '/history', label: '내역', icon: '🧾' },
]
const ADMIN_LINK: TabItem = { to: '/admin/meals', label: '관리', icon: '🛠️' }
const ADMIN_TABS: readonly TabItem[] = [
  { to: '/admin/meals', label: '식사', icon: '🍚' },
  { to: '/admin/issue', label: '발급', icon: '🎟️' },
  { to: '/', label: '내 식권', icon: '🎫' },
]

/** 가입을 마친 사람의 화면 틀: 내용 + 하단 탭. 탭 높이만큼 아래 여백을 둔다. */
export function PersonShell({ person, children }: { person: Person; children: ReactNode }) {
  const { pathname } = useLocation()
  const inAdminArea = pathname.startsWith('/admin')
  const items = inAdminArea ? ADMIN_TABS : person.role === 'admin' ? [...MEMBER_TABS, ADMIN_LINK] : MEMBER_TABS
  return (
    <div className="pb-20">
      {children}
      <TabBar items={items} />
    </div>
  )
}
