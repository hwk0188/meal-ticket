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

  it('변형마다 다른 배경을 쓴다', () => {
    const { rerender } = render(<Button>기본</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-blue-600')
    rerender(<Button variant="kakao">카카오</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-[#FEE500]')
    rerender(<Button variant="ghost">취소</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-white')
  })

  it('type 을 넘길 수 있다', () => {
    render(<Button type="button">닫기</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
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

  it('오류가 없으면 aria 속성을 붙이지 않는다', () => {
    render(<TextField label="이름" name="name" />)
    const input = screen.getByLabelText('이름')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('오류가 있으면 안내 문구를 input 에 연결한다', () => {
    render(<TextField label="이름" name="name" error="이름을 확인해 주세요" />)
    // 오류 문구가 <label> 안에 있어 접근성 이름에 함께 묶인다 ("이름 이름을 확인해 주세요").
    // 지금 구조의 알려진 한계라 역할로 찾는다.
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'name-error')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('이름을 확인해 주세요')
    expect(alert).toHaveAttribute('id', 'name-error')
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
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
  })

  it('문구를 바꿀 수 있다', () => {
    render(<Spinner label="연결에 문제가 있어요" />)
    expect(screen.getByRole('status')).toHaveTextContent('연결에 문제가 있어요')
  })
})
