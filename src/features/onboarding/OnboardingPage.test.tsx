import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { church } from '../../config/church'
import { personQueryKey } from '../auth/usePerson'
import { OnboardingPage } from './OnboardingPage'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: Record<string, string>) => Promise<RpcResult>>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
// 가입 화면은 로그인된 사람만 들어온다 (RequireSession). 돌려받은 사람 행을 그 사용자 키에 넣는다.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', session: { user: { id: 'u1' } } }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<p>home</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

const submitButton = () => screen.getByRole('button', { name: '동의하고 시작하기' })

async function fillValid() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-1234-5678')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
}

async function submitBadPhone() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123-4567')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
  await userEvent.click(submitButton())
}

describe('OnboardingPage', () => {
  it('고지 4요소와 처리방침 링크를 보여주고, 동의 전에는 버튼이 비활성이다', () => {
    renderPage()
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '자세히' })
    expect(link).toHaveAttribute('href', expect.stringContaining('privacy'))
    // 같은 탭에서 열면 적어 둔 이름·번호가 사라진다.
    expect(link).toHaveAttribute('target', '_blank')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText('동의에 체크하면 시작할 수 있어요')).toBeInTheDocument()
  })

  it('번호가 틀리면 오류를 보여주고 서버를 호출하지 않는다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveAttribute('aria-invalid', 'true')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('잘못된 입력을 제출하면 첫 오류 필드로 포커스를 옮긴다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // 이름은 정상이므로 건너뛰고 번호로 간다.
    expect(document.activeElement).toBe(screen.getByLabelText('휴대폰 번호'))
  })

  it('이름과 번호가 모두 비면 둘 다 알리고 이름으로 포커스를 옮긴다', async () => {
    renderPage()
    await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
    await userEvent.click(submitButton())
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(document.activeElement).toBe(screen.getByLabelText('이름'))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('입력을 고치기 시작하면 그 필드의 오류 표시가 사라진다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '8')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('휴대폰 번호')).not.toHaveAttribute('aria-invalid')
  })

  it('성공하면 claim_person을 정규화된 값으로 호출하고, 돌려받은 행을 캐시에 넣고 홈으로 간다', async () => {
    const person = { id: 'p1', name: '김철수', phone: '01012345678' }
    rpc.mockResolvedValue({ data: person, error: null })
    const { client } = renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(rpc).toHaveBeenCalledWith('claim_person', {
      p_name: '김철수',
      p_phone: '01012345678',
      p_consent_version: church.consentVersion,
    })
    expect(await screen.findByText('home')).toBeInTheDocument()
    // 홈이 같은 행을 다시 조회하지 않게 한다.
    expect(client.getQueryData(personQueryKey('u1'))).toEqual(person)
  })

  it('서버 오류 코드를 사용자 문구로 보여주고 버튼을 다시 연다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(submitButton()).not.toBeDisabled()
    // 적어 둔 값은 그대로 남아 있어야 고쳐서 다시 낼 수 있다.
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
  })

  it('서버 안내도 번호를 고치기 시작하면 사라진다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '9')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('already_registered 는 실패가 아니라 이미 성공한 것이므로 홈으로 간다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_registered' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('처리 중에는 버튼이 비활성이고 문구가 바뀐다', async () => {
    let settle: (v: { data: unknown; error: null }) => void = () => {}
    rpc.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled()
    settle({ data: { id: 'p1' }, error: null })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('"만 14세 미만이에요" 를 고르면 입력 폼 대신 연결 코드 안내와 링크가 보인다', async () => {
    renderPage()
    expect(screen.getByRole('radio', { name: '어른이에요' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: '만 14세 미만이에요' }))
    expect(screen.getByRole('radio', { name: '어른이에요' })).not.toBeChecked()
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
    expect(screen.getByText(/가족 › 자녀 추가/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '연결 코드 받기' })).toHaveAttribute('href', expect.stringContaining('pair'))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('다시 "어른이에요" 로 돌아오면 적던 내용이 남아 있다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름'), '김철수')
    await userEvent.click(screen.getByRole('radio', { name: '만 14세 미만이에요' }))
    await userEvent.click(screen.getByRole('radio', { name: '어른이에요' }))
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
  })
})
