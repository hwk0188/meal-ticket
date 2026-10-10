import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { rpcCodeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { adminBalancesQueryKey } from './useMeals'
import { allPeopleQueryKey } from './useAllPeople'
import { personDetailQueryKey } from './usePersonDetail'
import { personLedgerQueryKey } from './usePersonLedger'
import type { AdminPersonValues } from './personSchema'

/** 재조회 대기 한도. 넘으면 버튼을 먼저 풀어 준다 (4a 최종 리뷰 — 재조회에는 AbortSignal 이 없다). */
export const SETTLE_TIMEOUT_MS = 3_000

/**
 * 사람을 고치면 다시 읽어야 하는 것 전부: 사람 목록·그 사람 상세·이력, 그리고 장부의 가족이 옮겨질 수 있으니
 * 관리자 합계·식권·내역, 마지막으로 내 사람 행(합친 대상이 관리자 본인일 수 있다). 순서는 테스트가 단언한다.
 */
export function invalidatePeople(queryClient: QueryClient, personId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: allPeopleQueryKey }),
    queryClient.invalidateQueries({ queryKey: personDetailQueryKey(personId) }),
    queryClient.invalidateQueries({ queryKey: personLedgerQueryKey(personId) }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    queryClient.invalidateQueries({ queryKey: ['person'] }),
  ])
}

const settle = (queryClient: QueryClient, personId: string) =>
  Promise.race([invalidatePeople(queryClient, personId), new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))])

/** 이름·번호 수정. 함수가 아니라 people 의 관리자 update 정책(열 권한 name·phone)으로 바로 쓴다. */
export function useUpdatePerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: AdminPersonValues) =>
      unwrap(await supabase.from('people').update({ name: values.name, phone: values.phone }).eq('id', personId).select('id, name, phone').single()),
    onSuccess: () => settle(queryClient, personId),
  })
}

/** 중복 합치기: 보고 있는 사람이 into, 고른 사람이 from (from 이 익명화된다). */
export function useMergePeople(intoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (fromId: string) => unwrap(await supabase.rpc('merge_people', { p_from_id: fromId, p_into_id: intoId })),
    onSuccess: () => settle(queryClient, intoId),
  })
}

/** 사람 초기화: 익명화 + 계정 해제. 장부는 보존된다. */
export function useResetPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('admin_reset_person', { p_person_id: personId })),
    onSuccess: () => settle(queryClient, personId),
  })
}

/** 카카오 계정 수동 연결 (복구 경로). */
export function useLinkPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (authUserId: string) => unwrap(await supabase.rpc('link_person', { p_person_id: personId, p_auth_user_id: authUserId })),
    onSuccess: () => settle(queryClient, personId),
  })
}

/**
 * 사람 관리 화면의 오류 문구. 세 코드는 교인 맥락 문구가 이 화면에서 어색하다:
 *  · already_registered  가입 화면에서는 "이미 가입된 계정" 이지만 여기서는 "이 사람에게 계정이 이미 있다" 는 뜻
 *  · consent_required    가입 화면에서는 "동의해 주세요" 지만 여기서는 "그 사람의 동의 기록이 없다"
 *  · last_admin          탈퇴가 아니라 초기화를 막는 맥락
 */
export function personOpsErrorMessage(err: unknown): string {
  switch (rpcCodeOf(err)) {
    case 'already_registered':
      return '이 분은 이미 카카오 계정이 연결돼 있어요.'
    case 'consent_required':
      return '그 분의 동의 기록이 없어요. 본인이 가입 화면에서 동의해야 연결할 수 있어요.'
    case 'last_admin':
      return '마지막 관리자는 초기화할 수 없어요. 다른 관리자를 먼저 지정해 주세요.'
    default:
      return toUserMessage(err)
  }
}
