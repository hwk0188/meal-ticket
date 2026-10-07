import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { church } from '../config/church'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('교회명, 고지 4요소, 시행일, 돌아가기 링크를 보여준다', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(church.name)).length).toBeGreaterThan(0)
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    expect(screen.getByText(`시행일: ${church.consentVersion}`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '돌아가기' })).toHaveAttribute('href', '/')
  })

  it('카카오에서 받는 항목과 선택 동의를 설명한다', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    expect(screen.getByText(/프로필 사진과 카카오계정 이메일은 선택 동의/)).toBeInTheDocument()
  })

  it('담당자 이름·연락처가 비어 있으면 역할만 보여준다', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    expect(screen.getByText(church.privacyOfficer.role)).toBeInTheDocument()
  })
})
