import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from './env'

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    // GitHub Pages 는 <user>.github.io 한 오리진을 프로젝트들이 함께 쓴다.
    // 기본 키는 URL 에서 만들어지므로 프로젝트별로 고정 키를 준다.
    storageKey: 'meal-ticket-auth',
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
