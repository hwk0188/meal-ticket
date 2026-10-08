import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { codeOf, toUserMessage } from '../../lib/errors'
import type { Database } from '../../lib/database.types'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

type PeopleInsert = Database['public']['Tables']['people']['Insert']

export const SEARCH_MIN = 2
const SEARCH_LIMIT = 20
const COLUMNS = 'id, name, phone, auth_user_id, family_id, is_minor'
export const peopleSearchQueryKey = ['people-search'] as const

export type PersonHit = Pick<Person, 'id' | 'name' | 'phone' | 'auth_user_id' | 'family_id' | 'is_minor'>

/** 검색어에서 글자·숫자·공백만 남긴다. PostgREST 필터 문법 문자(쉼표·점·괄호)가 섞이면 or() 조건이 깨진다. */
export function sanitizeQuery(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
}

/** 이름 일부 또는 번호 뒷자리로 사람 찾기 (2글자부터). 탈퇴자·자녀 제외. 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다. */
export function usePeopleSearch(raw: string) {
  const q = sanitizeQuery(raw)
  const digits = q.replace(/\D/g, '')
  return useQuery({
    queryKey: [...peopleSearchQueryKey, q],
    enabled: q.length >= SEARCH_MIN,
    staleTime: 10_000,
    queryFn: async (): Promise<PersonHit[]> => {
      // 자녀는 발급 대상이 아니다 (DB 도 person_is_minor 로 거부). 검색 결과에서 아예 뺀다.
      const base = supabase.from('people').select(COLUMNS).is('deleted_at', null).eq('is_minor', false).order('name').limit(SEARCH_LIMIT)
      // base.or(...)/base.ilike(...) 는 서로 다른 빌더 타입을 돌려주므로(둘 다 PromiseLike) 분기마다 따로 await 한다.
      if (digits.length >= SEARCH_MIN) return unwrap(await base.or(`name.ilike.%${q}%,phone.like.%${digits}%`))
      return unwrap(await base.ilike('name', `%${q}%`))
    },
  })
}

/** 선발급 대상 "새로 등록". people 의 insert 정책(관리자, name·phone 열)으로 바로 넣는다. 번호 중복은 23505. */
export function useRegisterPerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: { name: string; phone: string }): Promise<PersonHit> => {
      // family_id 는 생성 타입엔 필수지만(열 자체가 not null) DB 트리거(people_before_write)가 비어 있으면
      // 1인 가족을 새로 만들어 채운다. grant insert 는 name·phone 열만 열어 뒀으니 실제로 보낼 값도 그 둘뿐이라
      // 트리거의 암묵 계약을 Insert 타입으로 단언한다(codegen 은 트리거 기본값을 모른다).
      const row = unwrap(await supabase.from('people').insert(values as PeopleInsert).select(COLUMNS).single())
      // .single() 의 타입은 null 을 허용하지만(런타임 응답 안전망) 한 행 insert·select 는 항상 행을 돌려준다.
      if (!row) throw new Error('useRegisterPerson: 등록된 사람을 받지 못했습니다')
      return row
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: peopleSearchQueryKey }),
  })
}

/** 새로 등록 실패 문구. 번호 중복(부분 유니크 인덱스 23505)은 "검색해서 선택" 으로 이끈다. */
export function registerErrorMessage(err: unknown): string {
  return codeOf(err) === '23505' ? '이미 등록된 번호예요. 검색해서 선택해 주세요.' : toUserMessage(err)
}
