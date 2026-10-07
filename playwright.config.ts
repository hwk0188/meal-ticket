import { defineConfig, devices } from '@playwright/test'

// Vite 개발 서버는 여기서 IPv6(`[::1]:5173`)로만 열린다. 127.0.0.1 로 적으면 접속이 되지 않으므로
// baseURL·webServer.url 모두 localhost 로 둔다.
const BASE_URL = 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // test.only 를 실수로 커밋하면 CI 가 나머지를 조용히 건너뛴다. CI 에서는 실패로 본다.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // 가입은 로컬 Supabase 왕복이 섞인다. 기본 5초로는 느린 기계에서 아깝게 깨진다.
  expect: { timeout: 10_000 },
  use: {
    // Pixel 7 은 Chromium 모바일 뷰포트다 (WebKit 을 따로 설치하지 않아도 된다).
    // 먼저 펼쳐 두어 아래 값들이 기기 설정에 덮이지 않게 한다.
    ...devices['Pixel 7'],
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
