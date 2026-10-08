import type { PostgrestError } from '@supabase/supabase-js'

export type PostgrestResponse<T> = { data: T; error: null } | { data: null; error: PostgrestError }

/** PostgREST 오류는 Error 가 아닌 평범한 객체다. message/code 를 보존해 Error 로 감싼다 (react-query 는 Error 를 기대한다). */
export function toError(error: PostgrestError): Error & { code: string } {
  return Object.assign(new Error(error.message), { code: error.code, cause: error })
}

/** 응답을 값으로 푼다. 오류면 던진다. maybeSingle 의 null 은 정상 값이다. */
export function unwrap<T>(result: PostgrestResponse<T>): T {
  if (result.error) throw toError(result.error)
  return result.data
}
