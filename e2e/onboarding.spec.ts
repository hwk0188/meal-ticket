import { expect, test } from '@playwright/test'
// tsconfig.node.json 이 이 파일을 nodenext 로 검사한다. 상대 경로 import 는 확장자가 있어야 하고,
// allowImportingTsExtensions 가 켜져 있어 '.ts' 를 그대로 적는다 (Playwright 의 TS 로더도 그대로 읽는다).
import { church } from '../src/config/church.ts'

test('개발 로그인 → 가입 → 홈 → 새로고침 유지 → 로그아웃', async ({ page }) => {
  const stamp = Date.now().toString().slice(-8) // 8자리 → 010 + 8자리 = 11자리 번호
  const email = `e2e-${stamp}@test.local`
  const phone = `010${stamp}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: church.appName })).toBeVisible()

  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill('password123')
  await page.getByRole('button', { name: '개발용 로그인' }).click()

  await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
  await expect(page.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled()

  await page.getByLabel('이름').fill('김철수')
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByLabel(/개인정보 수집·이용 동의/).check()
  await page.getByRole('button', { name: '동의하고 시작하기' }).click()

  await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
  await expect(page.getByText('오늘은 식사가 없어요')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
})

test('처리방침은 로그인 없이 볼 수 있다', async ({ page }) => {
  await page.goto('/#/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeVisible()
  await page.getByRole('link', { name: '돌아가기' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
})
