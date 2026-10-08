import type { PostgrestError } from '@supabase/supabase-js'

export type PostgrestResult<T> = { data: T; error: null } | { data: null; error: PostgrestError }

/** 타입은 PostgrestError 지만, throwOnError 없이 받은 응답의 error 는 Error 인스턴스가 아닌 평범한 객체다. message/code 를 보존해 Error 로 감싼다 (react-query 는 Error 를 기대한다). */
export function toError(error: PostgrestError): Error & { code: string } {
  return Object.assign(new Error(error.message, { cause: error }), { code: error.code })
}

/** 응답을 값으로 푼다. 오류면 던진다. maybeSingle 의 null 은 정상 값이다. */
export function unwrap<T>(result: PostgrestResult<T>): T {
  if (result.error) throw toError(result.error)
  return result.data
}
