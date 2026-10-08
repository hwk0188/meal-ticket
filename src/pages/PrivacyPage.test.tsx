import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { church } from '../config/church'
import { officerLine } from './officerLine'
import { PrivacyPage } from './PrivacyPage'

function renderPage() {
  return render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
}

describe('PrivacyPage', () => {
  it('교회명, 고지 4요소, 시행일, 돌아가기 링크를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(church.name)).length).toBeGreaterThan(0)
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    expect(screen.getByText(`시행일: ${church.consentVersion}`)).toBeInTheDocument()
    // 해시 라우팅·하위 경로 배포에 따라 href 접두사가 달라지므로 링크가 있는지만 본다.
    expect(screen.getByRole('link', { name: '돌아가기' })).toBeInTheDocument()
  })

  it('정보주체의 권리 행사 방법을 안내한다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '4. 정보주체의 권리와 행사 방법' })).toBeInTheDocument()
    expect(screen.getByText(/열람·정정·삭제·처리정지/)).toBeInTheDocument()
    expect(screen.getByText(/법정대리인은 자녀 몫을 대신 요청/)).toBeInTheDocument()
  })

  it('카카오에서 받는 항목과 선택 동의, 제3자 제공·보관 위치를 설명한다', () => {
    renderPage()
    expect(screen.getByText(/회원번호를 제공받아 로그인 계정 식별에만 사용/)).toBeInTheDocument()
    expect(screen.getByText(/닉네임·프로필 사진·카카오계정 이메일은 모두 선택 동의/)).toBeInTheDocument()
    expect(screen.getByText(/제3자에게 제공하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/국내\(서울\) 리전/)).toBeInTheDocument()
  })

  it('세션 토큰 저장과 안전조치를 설명한다', () => {
    renderPage()
    expect(screen.getByText(/브라우저 로컬 저장소에 세션 토큰/)).toBeInTheDocument()
    expect(screen.getByText(/광고·분석 목적의 쿠키는 쓰지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/접근 권한 정책\(RLS\)/)).toBeInTheDocument()
  })

  it('개인정보 담당자를 보여준다', () => {
    renderPage()
    expect(screen.getByText(new RegExp(church.privacyOfficer.role))).toBeInTheDocument()
  })
})

describe('officerLine', () => {
  it.each([
    {
      label: '이름·연락처가 비어 있으면 역할만 보여준다',
      officer: { role: '식당 담당 권사', name: '', phone: '' },
      expected: '식당 담당 권사',
    },
    {
      label: '이름만 있으면 역할 뒤에 이름을 붙인다',
      officer: { role: '식당 담당 권사', name: '김영희', phone: '' },
      expected: '식당 담당 권사 김영희',
    },
    {
      label: '이름과 연락처가 있으면 가운뎃점으로 잇는다',
      officer: { role: '식당 담당 권사', name: '김영희', phone: '010-1234-5678' },
      expected: '식당 담당 권사 김영희 · 010-1234-5678',
    },
  ])('$label', ({ officer, expected }) => {
    expect(officerLine(officer)).toBe(expected)
  })
})
