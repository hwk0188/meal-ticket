import { defineConfig, devices } from '@playwright/test'

// Vite 개발 서버는 여기서 IPv6(`[::1]:5173`)로만 열린다. 127.0.0.1 로 적으면 접속이 되지 않으므로
// baseURL·webServer.url 모두 localhost 로 둔다.
const BASE_URL = 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Pixel 7 은 Chromium 모바일 뷰포트다 (WebKit 을 따로 설치하지 않아도 된다).
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
