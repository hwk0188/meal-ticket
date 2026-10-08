import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from './SegmentedControl'

const options = [
  { value: 'adult', label: '어른이에요' },
  { value: 'minor', label: '만 14세 미만이에요' },
] as const

describe('SegmentedControl', () => {
  it('옵션을 라디오로 보여주고, 그룹에는 레이블을 단다', () => {
    render(<SegmentedControl label="가입 유형" options={options} value="adult" onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: '가입 유형' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '어른이에요' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '만 14세 미만이에요' })).toBeInTheDocument()
  })

  it('현재 값만 선택된 상태다', () => {
    render(<SegmentedControl label="가입 유형" options={options} value="adult" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: '어른이에요' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '만 14세 미만이에요' })).not.toBeChecked()
  })

  it('다른 옵션을 누르면 그 값으로 onChange 를 부른다', async () => {
    const onChange = vi.fn<(value: string) => void>()
    render(<SegmentedControl label="가입 유형" options={options} value="adult" onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: '만 14세 미만이에요' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('minor')
  })

  it('두 인풋이 같은 name 을 공유해 방향키로 오갈 수 있다', () => {
    render(<SegmentedControl label="가입 유형" options={options} value="adult" onChange={() => {}} />)
    const adult = screen.getByRole('radio', { name: '어른이에요' }) as HTMLInputElement
    const minor = screen.getByRole('radio', { name: '만 14세 미만이에요' }) as HTMLInputElement
    expect(adult.name).toBe(minor.name)
    expect(adult.name).not.toBe('')
  })
})
