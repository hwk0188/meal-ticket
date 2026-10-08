import { expect, test, type Page } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'

// supabase/seeds/010_e2e_admin.sql
// 이메일은 'admin@test.local' 이 아니라 'e2e-admin@test.local' 이다 — 시드 파일 주석 참고
// (supabase/tests/database/030_people_rls.sql 이 'admin@test.local' 을 pgTAP 전용 임시 사용자로 쓴다).
const ADMIN = { email: 'e2e-admin@test.local', password: 'password123' }

// 관리자 두 화면 + 교인 가입 + 사용 + 내역까지 한 흐름이라 기본 30초로는 모자란다
test.describe.configure({ timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

async function devLogin(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '개발용 로그인' }).click()
}

async function logout(page: Page) {
  await page.getByRole('link', { name: '내 식권' }).click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
}

/** 식권 한 장을 꾹 누른다 (마우스 다운 → 대기 → 업). Playwright 의 mouse 는 pointer 이벤트도 함께 낸다. */
async function hold(page: Page, name: string, ms: number) {
  // hover 는 스크롤·안정화·실제로 포인터를 받는지(덮인 요소 없음)까지 확인해 준다. Playwright 의 mouse 는 pointer 이벤트도 함께 낸다.
  const button = page.getByRole('button', { name })
  await button.hover()
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test('관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용 → 내역', async ({ page }) => {
  const digits = Date.now().toString().slice(-5) + String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
  const phone = `01${digits}`
  const mealTitle = `E2E 점심 ${digits}`
  const today = todaySeoul()
  const mealLabel = `${formatMealDate(today)} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 만들기', async () => {
    await devLogin(page, ADMIN.email, ADMIN.password)
    await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
    await page.getByRole('link', { name: '관리' }).click()
    await page.getByRole('button', { name: '+ 식사 직접 추가' }).click()
    await page.getByLabel('식사 이름').fill(mealTitle)
    // 날짜 기본값은 오늘
    await page.getByRole('button', { name: '식사 추가' }).click()
    await expect(page.getByRole('article', { name: new RegExp(mealTitle) })).toBeVisible()
  })

  await test.step('관리자: 새로 등록한 사람에게 2장 발급', async () => {
    await page.getByRole('link', { name: '발급' }).click()
    await page.getByRole('button', { name: '변경' }).click()
    await page.getByRole('button', { name: mealLabel, exact: true }).click()
    await page.getByRole('button', { name: '+ 새로 등록' }).click()
    // "이름" 은 검색창 레이블("이름 또는 번호 뒷자리")의 부분 문자열이라 strict mode 충돌이 난다 — exact 로 좁힌다
    await page.getByLabel('이름', { exact: true }).fill('김철수')
    await page.getByLabel('휴대폰 번호').fill(phone)
    await page.getByRole('button', { name: '등록하고 선택' }).click()
    await expect(page.getByRole('heading', { name: '김철수 님께 발급' })).toBeVisible()

    await page.getByLabel('단가 (원)').fill('5000')
    await page.getByRole('button', { name: '장수 늘리기' }).click()
    await expect(page.getByText('합계 10,000원')).toBeVisible()
    await page.getByRole('button', { name: '2장 발급하기' }).click()
    await expect(page.getByText('김철수 님께 2장 발급했어요')).toBeVisible() // role=status 는 여러 개일 수 있어 텍스트로 찾는다
    await logout(page)
  })

  await test.step('교인: 같은 이름·번호로 가입하면 선발급 식권이 보인다', async () => {
    await devLogin(page, `e2e-${digits}@test.local`, 'password123')
    await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
    await page.getByLabel('이름').fill('김철수')
    await page.getByLabel('휴대폰 번호').fill(phone)
    await page.getByLabel(/개인정보 수집·이용 동의/).check()
    await page.getByRole('button', { name: '동의하고 시작하기' }).click()

    await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
    await expect(page.getByRole('heading', { name: mealTitle })).toBeVisible()
    await expect(page.getByText('2장 남음')).toBeVisible()
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
  })

  await test.step('짧게 탭하면 아무 일도 없다', async () => {
    await hold(page, '식권 1번 꾹 눌러 사용하기', 100)
    await page.waitForTimeout(700)
    // 잘못 눌렸다면 mutate 직후 '처리 중…' 이, 성공했다면 '사용 처리되었어요' 가 바로 뜬다 — 둘 다 없어야 한다
    await expect(page.getByText(/사용 처리되었어요|처리 중/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
    await expect(page.getByText('2장 남음')).toBeVisible()
  })

  await test.step('600ms 꾹 누르면 1장이 회색이 된다', async () => {
    await hold(page, '식권 1번 꾹 눌러 사용하기', 900)
    await expect(page.getByText(/사용 처리되었어요/)).toBeVisible() // 텍스트로
    await expect(page.getByText('1장 남음')).toBeVisible()
    const items = page.getByRole('list', { name: '식권 목록' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('사용 완료')
    await expect(items.first()).toContainText('김철수 폰')
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(1)
  })

  await test.step('내역에 발급과 사용이 남는다', async () => {
    await page.getByRole('link', { name: '내역' }).click()
    await expect(page.getByText('발급 2장 · 10,000원')).toBeVisible()
    await expect(page.getByText('사용 1장 · 김철수 폰')).toBeVisible()
  })
})
