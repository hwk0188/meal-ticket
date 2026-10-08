import { expect, test } from '@playwright/test'
// tsconfig.node.json 이 이 파일을 nodenext 로 검사한다. 상대 경로 import 는 확장자가 있어야 하고,
// allowImportingTsExtensions 가 켜져 있어 '.ts' 를 그대로 적는다 (Playwright 의 TS 로더도 그대로 읽는다).
import { church } from '../src/config/church.ts'

// 환경변수 오설정처럼 부팅 단계에서 터지는 오류는 화면이 빈 채로 남아 '요소를 못 찾았다'로만 보인다.
// 페이지 오류를 그대로 던져 원인이 보고서에 남게 한다.
test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

// 개발 서버(npm run dev) 전용. 개발 로그인 폼은 import.meta.env.DEV 뒤에 있어 preview/운영 빌드에는 없다.
test('개발 로그인 → 가입 → 홈 → 새로고침 유지 → 로그아웃', async ({ page }) => {
  // people_phone_unique 와 충돌하지 않도록 시간(5자리) + 난수(4자리)를 섞는다.
  // '01' + 9자리 = 11자리이므로 is_valid_mobile(^01[0-9]{8,9}$)을 통과한다.
  const digits = Date.now().toString().slice(-5) + String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
  const email = `e2e-${digits}@test.local`
  const phone = `01${digits}`

  await test.step('로그인', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: church.appName })).toBeVisible()

    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill('password123')
    await page.getByRole('button', { name: '개발용 로그인' }).click()
  })

  await test.step('가입', async () => {
    await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
    await expect(page.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled()

    await page.getByLabel('이름').fill('김철수')
    await page.getByLabel('휴대폰 번호').fill(phone)
    await page.getByLabel(/개인정보 수집·이용 동의/).check()
    await page.getByRole('button', { name: '동의하고 시작하기' }).click()
  })

  await test.step('홈·새로고침', async () => {
    await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
    // 적어 넣은 번호가 claim_person(normalize_phone) 을 거쳐 maskPhone 으로 돌아오는지 본다.
    await expect(page.getByText(`${phone.slice(0, 3)}-****-${phone.slice(-4)}`)).toBeVisible()
    // 새 가족은 식권이 없다. 다만 다른 테스트·수동 작업이 오늘 식사를 만들어 두었을 수 있어 둘 중 하나를 받아들인다.
    await expect(page.getByText(/오늘은 식사가 없어요|이 식사의 식권이 없어요/).first()).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
  })

  await test.step('로그아웃', async () => {
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
  })
})

test('처리방침은 로그인 없이 볼 수 있다', async ({ page }) => {
  await page.goto('/#/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeVisible()
  await page.getByRole('link', { name: '돌아가기' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
})
