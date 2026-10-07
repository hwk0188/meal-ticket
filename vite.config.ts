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
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/lib/database.types.ts'],
        thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      },
    },
  }
})
