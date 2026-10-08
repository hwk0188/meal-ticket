import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Checkbox, Spinner, TextField } from './ui'

describe('Button', () => {
  it('클릭을 전달한다', async () => {
    const onClick = vi.fn<() => void>()
    render(<Button onClick={onClick}>확인</Button>)
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('비활성화되면 클릭이 전달되지 않는다', async () => {
    const onClick = vi.fn<() => void>()
    render(
      <Button disabled onClick={onClick}>
        확인
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('기본 type 은 button 이다 (폼 안에서 뜻하지 않게 제출되지 않는다)', () => {
    render(<Button>닫기</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('제출 버튼으로 바꿀 수 있다', () => {
    render(<Button type="submit">보내기</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })
})

describe('TextField', () => {
  it('label 과 input 을 연결한다 (name 을 id 로 쓴다)', async () => {
    render(<TextField label="이름" name="name" />)
    const input = screen.getByLabelText('이름')
    expect(input).toHaveAttribute('id', 'name')
    await userEvent.type(input, '김철수')
    expect(input).toHaveValue('김철수')
  })

  it('id 를 직접 주면 그 값을 쓴다', () => {
    render(<TextField label="휴대폰" id="phone-field" name="phone" />)
    expect(screen.getByLabelText('휴대폰')).toHaveAttribute('id', 'phone-field')
  })

  it('id 와 name 이 없어도 자동 id 로 서로 구분된다', () => {
    render(
      <>
        <TextField label="첫째" />
        <TextField label="둘째" />
      </>,
    )
    const first = screen.getByLabelText('첫째')
    const second = screen.getByLabelText('둘째')
    expect(first.id).toBeTruthy()
    expect(second.id).toBeTruthy()
    expect(first.id).not.toBe(second.id)
  })

  it('오류가 없으면 aria 속성을 붙이지 않는다', () => {
    render(<TextField label="이름" name="name" />)
    const input = screen.getByLabelText('이름')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('오류가 있어도 이름은 라벨 그대로고 안내는 설명으로 읽힌다', () => {
    render(<TextField label="이름" name="name" error="이름을 확인해 주세요" />)
    const input = screen.getByLabelText('이름')
    expect(input).toHaveAccessibleName('이름')
    expect(input).toHaveAccessibleDescription('이름을 확인해 주세요')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'name-error')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('이름을 확인해 주세요')
    expect(alert).toHaveAttribute('id', 'name-error')
  })

  it('호출하는 쪽의 aria-describedby 를 지우지 않고 합친다', () => {
    render(
      <>
        <p id="hint">숫자만 입력해 주세요</p>
        <TextField label="휴대폰" name="phone" aria-describedby="hint" error="번호를 확인해 주세요" />
      </>,
    )
    const input = screen.getByLabelText('휴대폰')
    expect(input).toHaveAttribute('aria-describedby', 'hint phone-error')
    expect(input).toHaveAccessibleDescription('숫자만 입력해 주세요 번호를 확인해 주세요')
  })

  it('오류가 없으면 호출하는 쪽의 aria-describedby 만 남는다', () => {
    render(<TextField label="휴대폰" name="phone" aria-describedby="hint" />)
    expect(screen.getByLabelText('휴대폰')).toHaveAttribute('aria-describedby', 'hint')
  })
})

describe('Checkbox', () => {
  it('문구를 라벨로 쓰고 체크 상태를 전달한다', async () => {
    const onChange = vi.fn<() => void>()
    render(
      <Checkbox name="consent" onChange={onChange}>
        개인정보 수집에 동의합니다
      </Checkbox>,
    )
    const box = screen.getByRole('checkbox', { name: '개인정보 수집에 동의합니다' })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    expect(box).toBeChecked()
    expect(onChange).toHaveBeenCalledOnce()
  })
})

describe('Spinner', () => {
  it('기본 문구를 읽어 준다', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중…')
  })

  it('문구를 바꾸면 그대로 보여 준다 (말줄임표를 덧붙이지 않는다)', () => {
    render(<Spinner label="연결에 문제가 있어요. 새로고침해 주세요" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('연결에 문제가 있어요. 새로고침해 주세요')
    expect(status.textContent).not.toContain('…')
  })

  it('기본은 화면 높이를 차지하고, inline 은 차지하지 않는다', () => {
    const { rerender } = render(<Spinner />)
    expect(screen.getByRole('status')).toHaveClass('min-h-dvh')

    rerender(<Spinner inline />)
    expect(screen.getByRole('status')).not.toHaveClass('min-h-dvh')
  })
})
