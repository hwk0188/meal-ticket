import { NavLink } from 'react-router'

export type TabItem = { to: string; label: string; icon: string }

/** 화면 맨 아래 고정 탭. 항목은 PersonShell 이 역할·영역에 따라 고른다. */
export function TabBar({ items }: { items: readonly TabItem[] }) {
  return (
    <nav aria-label="주요 메뉴" className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-sm">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              // '/' 는 모든 경로의 접두사라 정확히 일치할 때만 활성화한다
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'font-bold text-blue-600' : 'text-gray-500'}`
              }
            >
              <span aria-hidden className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
