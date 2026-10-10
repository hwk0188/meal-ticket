import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
