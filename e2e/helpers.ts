import { expect, type Page } from '@playwright/test'

// supabase/seeds/010_e2e_admin.sql — 'admin@test.local' 은 pgTAP 030 이 임시 사용자로 쓰므로 e2e- 접두어
export const ADMIN = { email: 'e2e-admin@test.local', password: 'password123' }

/** people_phone_unique 와 충돌하지 않는 9자리: 시간(5) + 난수(4). '01' + 9자리 = is_valid_mobile 통과 */
export function uniqueDigits(): string {
  return Date.now().toString().slice(-5) + String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
}

export async function devLogin(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '개발용 로그인' }).click()
}

/** 관리자 화면에서 로그아웃한다 — '내 식권' 탭은 관리자 탭에만 있다. 교인 화면에서는 쓰지 말 것. */
export async function logout(page: Page) {
  await page.getByRole('link', { name: '내 식권' }).click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
}

/** 식권 한 장을 꾹 누른다. hover 가 스크롤·안정화·덮인 요소 없음까지 확인해 준다. mouse 는 pointer 이벤트도 함께 낸다. */
export async function hold(page: Page, name: string, ms: number) {
  const button = page.getByRole('button', { name })
  await button.hover()
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

/** 관리자로 개발 로그인하고 홈까지. */
export async function adminLogin(page: Page) {
  await devLogin(page, ADMIN.email, ADMIN.password)
  await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
}

/** 관리 › 식사 › "+ 식사 직접 추가" 로 오늘 식사를 만든다 (날짜 기본값이 오늘이다). */
export async function adminCreateTodayMeal(page: Page, mealTitle: string) {
  await page.getByRole('link', { name: '관리' }).click()
  await page.getByRole('button', { name: '+ 식사 직접 추가' }).click()
  await page.getByLabel('식사 이름').fill(mealTitle)
  await page.getByRole('button', { name: '식사 추가' }).click()
  await expect(page.getByRole('article', { name: new RegExp(mealTitle) })).toBeVisible()
}

type IssueOne = { mealLabel: string; name: string; phone: string; quantity: number; unitPrice: number }

/** 발급 › 식사 고르기 › "+ 새로 등록" › 장수·단가 › 발급. 등록·발급을 한 사람에게 한 번 한다. */
export async function adminIssue(page: Page, { mealLabel, name, phone, quantity, unitPrice }: IssueOne) {
  await page.getByRole('link', { name: '발급', exact: true }).click()
  await page.getByRole('button', { name: '변경' }).click()
  await page.getByRole('button', { name: mealLabel, exact: true }).click()
  await page.getByRole('button', { name: '+ 새로 등록' }).click()
  // "이름" 은 검색창 레이블("이름 또는 번호 뒷자리")의 부분 문자열 — exact 로 좁힌다
  await page.getByLabel('이름', { exact: true }).fill(name)
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByRole('button', { name: '등록하고 선택' }).click()
  await expect(page.getByRole('heading', { name: `${name} 님께 발급` })).toBeVisible()
  await page.getByLabel('단가 (원)').fill(String(unitPrice))
  for (let i = 1; i < quantity; i++) await page.getByRole('button', { name: '장수 늘리기' }).click()
  await expect(page.getByText(`합계 ${(quantity * unitPrice).toLocaleString('ko-KR')}원`)).toBeVisible()
  await page.getByRole('button', { name: `${quantity}장 발급하기` }).click()
  await expect(page.getByText(`${name} 님께 ${quantity}장 발급했어요`)).toBeVisible()
}

type IssueArgs = { mealTitle: string; mealLabel: string; name: string; phone: string }

/** 관리자로 로그인해 오늘 식사를 만들고, "새로 등록" 한 사람에게 5,000원 × 2장을 발급한 뒤 로그아웃한다. */
export async function adminCreateTodayMealAndIssueTwo(page: Page, { mealTitle, mealLabel, name, phone }: IssueArgs) {
  await adminLogin(page)
  await adminCreateTodayMeal(page, mealTitle)
  await adminIssue(page, { mealLabel, name, phone, quantity: 2, unitPrice: 5000 })
  await logout(page)
}

/** 선발급된 이름·번호로 가입하면 자동 연결된다 (claim_person). 홈까지. */
export async function signUpAsPrepaid(page: Page, { email, name, phone }: { email: string; name: string; phone: string }) {
  await devLogin(page, email, 'password123')
  await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
  await page.getByLabel('이름').fill(name)
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByLabel(/개인정보 수집·이용 동의/).check()
  await page.getByRole('button', { name: '동의하고 시작하기' }).click()

  await expect(page.getByRole('heading', { name: `${name} 님` })).toBeVisible()
}
