import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { adminCreateTodayMealAndIssueTwo, hold, signUpAsPrepaid, uniqueDigits } from './helpers.ts'

// 두 폰(보호자·아이)을 번갈아 쓰고 폴링(3초·5초)을 기다린다
test.describe.configure({ timeout: 180_000 })

test('아이 익명 시작 → 코드 → 보호자 자녀 추가 → 아이 폰에 가족 잔량 → 아이 폰에서 사용', async ({ browser }) => {
  const digits = uniqueDigits()
  const phone = `01${digits}`
  const mealTitle = `E2E 가족 ${digits}`
  const mealLabel = `${formatMealDate(todaySeoul())} · ${mealTitle}`
  // 프로젝트의 use(Pixel 7·baseURL·trace)는 Playwright 가 모든 newContext 에 자동으로 넣어 준다 — 여기서 두 컨텍스트는
  // localStorage 가 분리된 두 대의 폰이라는 뜻만 남는다.
  const parentContext = await browser.newContext()
  const childContext = await browser.newContext()
  const parent = await parentContext.newPage()
  const child = await childContext.newPage()
  for (const page of [parent, child]) {
    page.on('pageerror', (e) => {
      throw e
    })
  }

  try {
    await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
      await adminCreateTodayMealAndIssueTwo(parent, { mealTitle, mealLabel, name: '김철수', phone })
    })

    await test.step('보호자: 선발급 이름·번호로 가입 → 2장', async () => {
      await signUpAsPrepaid(parent, { email: `e2e-parent-${digits}@test.local`, name: '김철수', phone })
      await expect(parent.getByText('2장 남음')).toBeVisible()
      await expect(parent.getByText('내 식권')).toBeVisible() // 1인 가족 머리말. 보호자가 관리자가 아니라서 '내 식권' 탭과 겹치지 않는다
    })

    const code = await test.step('아이: 아이 계정으로 시작 → 연결 코드', async () => {
      await child.goto('/')
      await child.getByRole('button', { name: /아이 계정으로 시작하기/ }).click()
      await expect(child.getByRole('heading', { name: '보호자에게 이 코드를 보여 주세요' })).toBeVisible()
      await expect(child.getByText(/남음 · 1회용/)).toBeVisible()
      // 코드 노드에는 코드만 있다("1234 5678"). 남은 시간은 형제 노드라 매초 다시 그려져도 여기엔 안 섞인다.
      await expect(child.getByTestId('pairing-code')).toHaveText(/^\d{4} \d{4}$/)
      return ((await child.getByTestId('pairing-code').textContent()) ?? '').replace(/\D/g, '')
    })

    await test.step('보호자: 가족 탭 › 자녀 추가', async () => {
      await parent.getByRole('link', { name: '가족' }).click()
      await expect(parent.getByText('우리 가족 · 1명')).toBeVisible()
      await parent.getByRole('button', { name: '+ 자녀 추가' }).click()
      await parent.getByLabel('자녀 이름').fill('서연')
      await parent.getByLabel('자녀 폰에 뜬 코드').fill(code)
      await parent.getByLabel(/법정대리인 동의/).check()
      await parent.getByRole('button', { name: '연결하기', exact: true }).click()
      await expect(parent.getByText('서연 님을 연결했어요')).toBeVisible()
      await expect(parent.getByText('우리 가족 · 2명')).toBeVisible()
      const rows = parent.getByRole('list', { name: '가족 구성원' }).getByRole('listitem')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(1)).toContainText('서연')
      await expect(rows.nth(1)).toContainText('자녀')
    })

    await test.step('아이 폰: 저절로 홈 → 우리 가족 식권 2장, 가족 탭 없음', async () => {
      await expect(child.getByRole('heading', { name: '서연 님', level: 1 })).toBeVisible({ timeout: 15_000 }) // 3초 폴링
      await expect(child.getByText('우리 가족 식권 · 2명')).toBeVisible()
      await expect(child.getByRole('heading', { name: mealTitle })).toBeVisible()
      await expect(child.getByText('2장 남음')).toBeVisible()
      await expect(child.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
      await expect(child.getByRole('link', { name: '가족' })).toHaveCount(0)
    })

    await test.step('아이 폰에서 1장 사용 → 보호자 폰에도 "서연 폰"', async () => {
      await hold(child, '식권 1번 꾹 눌러 사용하기', 900)
      await expect(child.getByText(/사용 처리되었어요/)).toBeVisible()
      await expect(child.getByText('1장 남음')).toBeVisible()
      await parent.getByRole('link', { name: '식권', exact: true }).click()
      await expect(parent.getByText('1장 남음')).toBeVisible({ timeout: 15_000 }) // 5초 폴링
      const items = parent.getByRole('list', { name: '식권 목록' }).getByRole('listitem')
      await expect(items.first()).toContainText('사용 완료')
      await expect(items.first()).toContainText('서연 폰')
    })

    await test.step('아이 폰 로그아웃은 한 번 더 묻는다', async () => {
      await child.getByRole('button', { name: '로그아웃' }).click()
      await expect(child.getByText(/보호자가 새 코드로 다시 연결해야 해요/)).toBeVisible()
      await child.getByRole('button', { name: '취소' }).click()
      await expect(child.getByRole('heading', { name: '서연 님', level: 1 })).toBeVisible()
    })
  } finally {
    await parentContext.close()
    await childContext.close()
  }
})
