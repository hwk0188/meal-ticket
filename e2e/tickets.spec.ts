import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { adminCreateTodayMealAndIssueTwo, hold, signUpAsPrepaid, uniqueDigits } from './helpers.ts'

// 관리자 두 화면 + 교인 가입 + 사용 + 내역까지 한 흐름이라 기본 30초로는 모자란다
test.describe.configure({ timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용 → 내역', async ({ page }) => {
  const digits = uniqueDigits()
  const phone = `01${digits}`
  const mealTitle = `E2E 점심 ${digits}`
  const today = todaySeoul()
  const mealLabel = `${formatMealDate(today)} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
    await adminCreateTodayMealAndIssueTwo(page, { mealTitle, mealLabel, name: '김철수', phone })
  })

  await test.step('교인: 같은 이름·번호로 가입하면 선발급 식권이 보인다', async () => {
    await signUpAsPrepaid(page, { email: `e2e-${digits}@test.local`, name: '김철수', phone })
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
