import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('앱 제목을 보여준다', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '교회 식권 앱' })).toBeInTheDocument()
  })
})
