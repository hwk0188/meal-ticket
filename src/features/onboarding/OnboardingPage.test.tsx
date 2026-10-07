import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { OnboardingPage } from './OnboardingPage'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: Record<string, string>) => Promise<RpcResult>>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillValid() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-1234-5678')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
}

describe('OnboardingPage', () => {
  it('고지 4요소와 처리방침 링크를 보여주고, 동의 전에는 버튼이 비활성이다', () => {
    renderPage()
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '자세히' })).toHaveAttribute('href', expect.stringContaining('privacy'))
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled()
  })

  it('번호가 틀리면 오류를 보여주고 서버를 호출하지 않는다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름'), '김철수')
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123-4567')
    await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveAttribute('aria-invalid', 'true')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('성공하면 claim_person을 정규화된 값으로 호출하고 홈으로 간다', async () => {
    rpc.mockResolvedValue({ data: { id: 'p1' }, error: null })
    renderPage()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(rpc).toHaveBeenCalledWith('claim_person', {
      p_name: '김철수',
      p_phone: '01012345678',
      p_consent_version: '2026-10-07',
    })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('서버 오류 코드를 사용자 문구로 보여주고 버튼을 다시 연다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).not.toBeDisabled()
  })

  it('already_registered 는 실패가 아니라 이미 성공한 것이므로 홈으로 간다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_registered' } })
    renderPage()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
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
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled()
    settle({ data: { id: 'p1' }, error: null })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})
