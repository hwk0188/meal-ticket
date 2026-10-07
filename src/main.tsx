import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// env.ts 가 import 시점에 throw 하면(환경변수 누락) 흰 화면 대신 안내를 띄운다.
// 주의: 이 파일에서 env.ts/supabase.ts 에 닿는 모듈을 정적 import 하면 이 보호가 무력화된다. 반드시 동적 import 로만.
import('./App')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((err: unknown) => {
    console.error(err)
    root.render(
      <main style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 18 }}>앱을 시작할 수 없어요</h1>
        <p style={{ color: '#555' }}>잠시 후 새로고침해 주세요. 계속되면 관리자에게 알려 주세요.</p>
        <button
          type="button"
          onClick={() => {
            window.location.reload()
          }}
        >
          새로고침
        </button>
      </main>,
    )
  })
