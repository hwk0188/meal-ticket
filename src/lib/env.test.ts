import { parseEnv } from './env'

const valid = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  VITE_ENABLE_DEV_LOGIN: 'true',
}

describe('parseEnv', () => {
  it('올바른 값을 구조화해 돌려준다', () => {
    expect(parseEnv(valid)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_x',
      enableDevLogin: true,
    })
  })

  it('개발 로그인 플래그가 없으면 false', () => {
    const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = valid
    expect(parseEnv({ VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY }).enableDevLogin).toBe(false)
  })

  it('필수 값이 빠지면 어떤 키인지 알려주며 실패한다', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })
})
