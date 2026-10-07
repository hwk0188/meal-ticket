import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래에 배포되므로 CI에서 VITE_BASE_PATH=/<repo>/ 를 넣는다.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
})
