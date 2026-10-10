import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { ADMIN, adminCreateTodayMealAndIssueTwo, devLogin, uniqueDigits } from './helpers.ts'

// 발급 → 현황판 → 대신 사용 → 무효 → 취소까지 한 흐름
test.describe.configure({ timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('관리자 식사 현황판: 발급 명단 → 1장 대신 사용 → 무효 → 발급 취소', async ({ page }) => {
  const digits = uniqueDigits()
  const phone = `01${digits}`
  const mealTitle = `E2E 현황 ${digits}`
  const dateLabel = formatMealDate(todaySeoul())
  const mealLabel = `${dateLabel} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
    await adminCreateTodayMealAndIssueTwo(page, { mealTitle, mealLabel, name: '김철수', phone }) // 끝에 로그아웃한다
  })

  await test.step('식사 탭 › 현황: 네 숫자와 가족 블록', async () => {
    await devLogin(page, ADMIN.email, ADMIN.password)
    await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
    await page.getByRole('link', { name: '관리' }).click()
    await page.getByRole('link', { name: `${dateLabel} ${mealTitle} 현황` }).click()
    await expect(page.getByRole('heading', { level: 1, name: mealLabel })).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()
    const family = page.getByRole('listitem', { name: '김철수', exact: true })
    await expect(family).toContainText('2장 중 0장 사용')
    await expect(family).toContainText('발급 2장 · 김철수 · 10,000원')
  })

  await test.step('1장 대신 사용 → 2장 중 1장, 취소 불가 안내', async () => {
    await page.getByRole('button', { name: '김철수 1장 대신 사용' }).click()
    await page.getByRole('button', { name: '사용 처리', exact: true }).click()
    await expect(page.getByText('김철수 가족 식권 1장을 사용 처리했어요')).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 1장 · 남음 1장 · 10,000원')).toBeVisible()
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('김철수 몫 · 담당자 처리')
    // 한 번 눌렀으니 사용 줄도 하나 (대신 사용은 멱등이 아니다 — Task 4 리뷰)
    // ConfirmButton 의 sr-only 접두사에도 같은 글자가 있어 행 안 getByText 는 '$' 로 줄 본문만 맞춘다 (Task 5 리뷰)
    await expect(page.getByRole('listitem', { name: '김철수', exact: true }).getByText(/담당자 처리$/)).toHaveCount(1)
    // 남은 1장 < 발급 2장 → 이 발급은 취소할 수 없다
    await expect(page.getByRole('button', { name: /김철수 2장 발급 취소$/ })).toBeDisabled() // 접근성 이름은 '<발급 시각> 김철수 2장 발급 취소'
    await expect(page.getByText('남은 장수(1)보다 많아 취소할 수 없어요')).toBeVisible()
  })

  await test.step('무효 처리 → 다시 2장 남음', async () => {
    await page.getByRole('button', { name: /사용 무효$/ }).click()
    await page.getByRole('button', { name: '무효 처리', exact: true }).click()
    await expect(page.getByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()
    // '무효' 글자는 버튼 이름에도 있으므로, 버튼이 사라지고 줄이 남는 것으로 확인한다
    await expect(page.getByRole('button', { name: /사용 무효$/ })).toHaveCount(0)
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('사용 1장 · 김철수 몫 · 담당자 처리')
    await expect(page.getByRole('button', { name: /김철수 2장 발급 취소$/ })).toBeEnabled()
  })

  await test.step('발급 취소 → 0장', async () => {
    await page.getByRole('button', { name: /김철수 2장 발급 취소$/ }).click()
    await page.getByRole('button', { name: '취소하기', exact: true }).click()
    await expect(page.getByText('김철수 님 2장 발급을 취소했어요')).toBeVisible()
    await expect(page.getByText('발급 0장 · 사용 0장 · 남음 0장 · 0원')).toBeVisible()
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('취소됨')
  })
})
