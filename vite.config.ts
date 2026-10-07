import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래에 배포되므로 CI에서 VITE_BASE_PATH=/<repo>/ 를 넣는다.
// loadEnv 로 .env.local 과 셸 환경변수 둘 다 읽는다. 빈 값은 '/' 로 본다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // 테스트에서 import.meta.env 를 읽는 모듈(src/lib/env.ts)이 깨지지 않도록 기본값을 준다.
      // 테스트별로 바꿀 때는 vi.stubEnv 를 쓴다 (unstubEnvs 로 자동 복원).
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        VITE_ENABLE_DEV_LOGIN: 'false',
      },
      clearMocks: true,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        reportOnFailure: true,
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/lib/database.types.ts',
          // 설정만 담은 배선 파일(테스트 대상 로직이 없다).
          'src/lib/supabase.ts',
        ],
        thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      },
    },
  }
})
