import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MealForm } from './MealForm'

describe('MealForm', () => {
  it('날짜 기본값은 오늘이고, 검증을 통과하면 정리된 값으로 onSubmit', async () => {
    const onSubmit = vi.fn<(v: { title: string; served_on: string; note: string | null }) => void>()
    render(<MealForm today="2026-10-08" pending={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByLabelText('날짜')).toHaveValue('2026-10-08')
    await userEvent.type(screen.getByLabelText('식사 이름'), ' 추수감사 점심 ')
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: '추수감사 점심', served_on: '2026-10-08', note: null })
  })

  it('비어 있으면 오류를 보여 주고 제출하지 않는다', async () => {
    const onSubmit = vi.fn<() => void>()
    render(<MealForm today="2026-10-08" pending={false} onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(screen.getByText('식사 이름을 적어 주세요')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('처리 중이면 버튼이 잠긴다 · 취소 버튼', async () => {
    const onCancel = vi.fn<() => void>()
    render(<MealForm today="2026-10-08" pending onSubmit={() => {}} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: '추가 중…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
