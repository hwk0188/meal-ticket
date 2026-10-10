import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { formatPhone } from '../src/lib/phone.ts'
import { adminCreateTodayMeal, adminIssue, adminLogin, uniqueDigits } from './helpers.ts'

// 발급 두 번 → 사람 탭 → 합치기 → 취소 사유 → 초기화까지 한 흐름
test.describe.configure({ timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('관리자 사람 탭: 중복 합치기 → 이력 합산 → 취소 사유 → 초기화', async ({ page }) => {
  const digits = uniqueDigits()
  const phoneA = `01${digits}`
  const phoneB = `01${uniqueDigits()}`
  // 이름은 이 실행만의 고유값 — 사람 목록 검색이 다른 실행이 남긴 행과 섞이지 않게 한다
  const name = `중복테스트${digits.slice(-5)}`
  const mealTitle = `E2E 사람 ${digits}`
  const mealLabel = `${formatMealDate(todaySeoul())} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 + 같은 이름 두 사람에게 발급(2장·1장)', async () => {
    await adminLogin(page)
    await adminCreateTodayMeal(page, mealTitle)
    await adminIssue(page, { mealLabel, name, phone: phoneA, quantity: 2, unitPrice: 5000 })
    await adminIssue(page, { mealLabel, name, phone: phoneB, quantity: 1, unitPrice: 5000 })
  })

  await test.step('사람 탭: 검색하면 둘, 상세에 전체 번호와 이력', async () => {
    await page.getByRole('link', { name: '사람', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '사람' })).toBeVisible()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByRole('list', { name: '사람 목록' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('link', { name: formatPhone(phoneA) }).click()
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    // "가족" 절은 자기 자신도 ('본인' 태그로) 보여 주므로 같은 번호가 한 번 더 나온다 — 먼저 그려지는 상단 소개줄만 본다
    await expect(page.getByText(formatPhone(phoneA)).first()).toBeVisible()
    const history = page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')
    await expect(history).toHaveCount(1)
    await expect(history.first()).toContainText('발급 2장 · 10,000원')
  })

  await test.step('중복 합치기: 방향을 확인하고 합치면 이력이 합쳐진다', async () => {
    await page.getByRole('button', { name: '중복 사람 합치기' }).click()
    await page.getByLabel('합칠 사람 찾기').fill(phoneB.slice(-4))
    // 선택 버튼의 접근성 이름은 '이름(번호) 선택' — 번호까지 붙여야 찾는다
    await page.getByRole('button', { name: `${name}(${formatPhone(phoneB)}) 선택` }).click()
    // 방향이 분명해야 한다: 고른 쪽(B)이 익명 처리되고 보고 있던 쪽(A)이 남는다
    await expect(page.getByText(new RegExp(`${name}\\(${formatPhone(phoneB)}\\) 의 기록·자녀·계정을 ${name}\\(${formatPhone(phoneA)}\\) 로 옮기고`))).toBeVisible()
    await page.getByRole('button', { name: '합치기' }).click()
    await expect(page.getByText(`${name} 님으로 합쳤어요`)).toBeVisible()
    const history = page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')
    await expect(history).toHaveCount(2)
    await expect(history.filter({ hasText: '발급 1장' })).toHaveCount(1)
  })

  await test.step('사람 목록에는 하나만 남는다', async () => {
    await page.getByRole('link', { name: '← 사람' }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByRole('list', { name: '사람 목록' }).getByRole('listitem')).toHaveCount(1)
  })

  await test.step('현황판: 사유를 적어 1장 발급을 취소하면 이력에 사유가 보인다', async () => {
    await page.getByRole('link', { name: '식사', exact: true }).click()
    await page.getByRole('link', { name: `${formatMealDate(todaySeoul())} ${mealTitle} 현황` }).click()
    await expect(page.getByText('발급 3장 · 사용 0장 · 남음 3장 · 15,000원')).toBeVisible()
    await page.getByRole('button', { name: new RegExp(`${name} 1장 발급 취소$`) }).click()
    await page.getByLabel('취소 사유 (선택)').fill('입금 취소')
    await page.getByRole('button', { name: '취소하기', exact: true }).click()
    await expect(page.getByText(`${name} 님 1장 발급을 취소했어요`)).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()

    await page.getByRole('link', { name: '사람', exact: true }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await page.getByRole('link', { name: formatPhone(phoneA) }).click()
    await expect(page.getByRole('list', { name: '발급·사용 이력' }).getByText('취소됨 · 입금 취소')).toBeVisible()
  })

  await test.step('사람 초기화: 목록에서 사라지고 상세는 기록만 남는다', async () => {
    await page.getByRole('button', { name: '사람 초기화' }).click()
    await page.getByRole('button', { name: '초기화', exact: true }).click()
    await expect(page.getByText(`${name} 님을 초기화했어요`)).toBeVisible()
    await expect(page.getByText('초기화·합쳐진 사람이에요. 기록만 남아 있어요.')).toBeVisible()
    await expect(page.getByRole('button', { name: '중복 사람 합치기' })).toHaveCount(0)
    // 기록은 남는다
    await expect(page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('link', { name: '← 사람' }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByText('찾는 사람이 없어요')).toBeVisible()
  })
})
