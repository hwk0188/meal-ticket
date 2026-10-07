import { z } from 'zod'

// zod v4 기준. z.string().url() 은 v4 에서 deprecated 라 z.url() 을 쓴다.
// 개발 로그인 플래그는 catch 로 fail-closed: 비어 있거나 모르는 값('TRUE' 등)이면 꺼진 것으로 본다.
// (.env.example 은 운영에서 이 값을 비워 두라고 안내한다 — 그때 앱이 죽으면 안 된다.)
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_ENABLE_DEV_LOGIN: z.enum(['true', 'false']).catch('false'),
})

export type Env = {
  supabaseUrl: string
  supabasePublishableKey: string
  enableDevLogin: boolean
}

/** 환경변수를 검증해 앱에서 쓰기 좋은 모양으로 바꾼다. 실패하면 어떤 키가 왜 틀렸는지 적어 준다. */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const reasons = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    throw new Error(`환경변수가 올바르지 않습니다: ${reasons}`)
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    enableDevLogin: result.data.VITE_ENABLE_DEV_LOGIN === 'true',
  }
}

// 모듈을 처음 읽을 때 검증한다 (빠른 실패). 테스트에서는 vite.config.ts 의 test.env 가 값을 준다.
export const env: Env = parseEnv(import.meta.env)
