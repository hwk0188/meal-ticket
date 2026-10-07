import { z } from 'zod'

// zod v4 기준. z.string().url() 은 v4 에서 deprecated 라 z.url() 을 쓴다.
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_ENABLE_DEV_LOGIN: z.enum(['true', 'false']).default('false'),
})

export type Env = {
  supabaseUrl: string
  supabasePublishableKey: string
  enableDevLogin: boolean
}

/** 환경변수를 검증해 앱에서 쓰기 좋은 모양으로 바꾼다. 빠진 키는 메시지에 그대로 적어 준다. */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const keys = result.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`환경변수가 올바르지 않습니다: ${keys}`)
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    enableDevLogin: result.data.VITE_ENABLE_DEV_LOGIN === 'true',
  }
}

// 모듈을 처음 읽을 때 검증한다 (빠른 실패). 테스트에서는 vite.config.ts 의 test.env 가 값을 준다.
export const env: Env = parseEnv(import.meta.env as Record<string, unknown>)
