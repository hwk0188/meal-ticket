import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TabBar } from './TabBar'

const items = [
  { to: '/', label: '식권', icon: '🎫' },
  { to: '/history', label: '내역', icon: '🧾' },
]

describe('TabBar', () => {
  it('항목을 링크로 그리고 현재 경로를 표시한다', () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <TabBar items={items} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '식권' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '내역' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '식권' })).not.toHaveAttribute('aria-current')
  })

  it('홈(/) 탭은 정확히 일치할 때만 활성화된다', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TabBar items={items} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '식권' })).toHaveAttribute('aria-current', 'page')
  })
})
