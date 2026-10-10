import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { rpcCodeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { MEAL_DETAIL_QUERY_KEY } from './useMealDetail'
import { OPS_TIMEOUT_MS } from './useMealOps'
import { adminBalancesQueryKey } from './useMeals'
import { allPeopleQueryKey } from './useAllPeople'
import { PERSON_DETAIL_QUERY_KEY, personDetailQueryKey } from './usePersonDetail'
import { PERSON_LEDGER_QUERY_KEY } from './usePersonLedger'
import type { AdminPersonValues } from './personSchema'

/** 재조회 대기 한도. 넘으면 버튼을 먼저 풀어 준다 (4a 최종 리뷰 — 재조회에는 AbortSignal 이 없다). */
export const SETTLE_TIMEOUT_MS = 3_000

/**
 * 사람을 고치면 다시 읽어야 하는 것 전부: 사람 목록, 그리고 사람 상세·이력은 **접두사로** 전부 —
 * 합치기·초기화는 "남는 쪽"뿐 아니라 "익명 처리되는 쪽"(상대편) 의 이름·이력도 바꾸고, 관리자가 그 페이지를
 * 거쳐 왔다면 상대편 상세·이력이 캐시에 그대로 남아 있을 수 있다(어느 쪽 id 인지 몰라도 되게 접두사로 덮는다 —
 * useMealOps 의 PERSON_LEDGER_QUERY_KEY 접두사 무효화와 같은 이유). 장부의 가족이 옮겨질 수 있으니 관리자
 * 합계·식권·내역, 내 사람 행(합친 대상이 관리자 본인일 수 있다), 그리고 식사 현황판(구매자 이름·가족 묶음이
 * 낡는다 — 어느 식사인지 몰라도 되게 접두사로). 순서는 테스트가 단언한다.
 */
export function invalidatePeople(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: allPeopleQueryKey }),
    queryClient.invalidateQueries({ queryKey: PERSON_DETAIL_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: PERSON_LEDGER_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    queryClient.invalidateQueries({ queryKey: ['person'] }),
    queryClient.invalidateQueries({ queryKey: MEAL_DETAIL_QUERY_KEY }),
  ])
}

const settle = (queryClient: QueryClient) =>
  Promise.race([invalidatePeople(queryClient), new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))])

// 서버가 판정한 거부(코드 있음)일 때만 그 사람의 상세를(+필요하면 다른 키도) 다시 읽는다 — 통신 오류에는 같은 요청을
// 그대로 다시 보내도 되므로 재조회하지 않는다(useMealOps 의 makeRefreshBoard 와 같은 규칙). 이렇게 해야
// person_not_found(다른 관리자가 먼저 합쳤다)·both_have_accounts(bothLinked 가 낡은 행으로 계산됐다) 뒤에도
// 패널이 같은 불가능한 동작을 켜진 버튼으로 계속 권하지 않는다.
const makeRefreshOnReject = (queryClient: QueryClient, keys: readonly (readonly unknown[])[]) => (err: unknown) =>
  rpcCodeOf(err) ? Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))) : undefined

/** 이름·번호 수정. 함수가 아니라 people 의 관리자 update 정책(열 권한 name·phone)으로 바로 쓴다. */
export function useUpdatePerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: AdminPersonValues) =>
      unwrap(await supabase.from('people').update({ name: values.name, phone: values.phone }).eq('id', personId).select('id, name, phone').single()),
    onSuccess: () => settle(queryClient),
  })
}

/** 중복 합치기: 보고 있는 사람이 into, 고른 사람이 from (from 이 익명화된다). */
export function useMergePeople(intoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (fromId: string) => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('merge_people', { p_from_id: fromId, p_into_id: intoId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => settle(queryClient),
    // person_not_found 는 into 자체가 낡았다는 뜻, both_have_accounts 는 후보 목록의 계정 여부가 낡았다는 뜻 — 둘 다 다시 읽는다.
    onError: makeRefreshOnReject(queryClient, [personDetailQueryKey(intoId), allPeopleQueryKey]),
  })
}

/** 사람 초기화: 익명화 + 계정 해제. 장부는 보존된다. */
export function useResetPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('admin_reset_person', { p_person_id: personId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => settle(queryClient),
    onError: makeRefreshOnReject(queryClient, [personDetailQueryKey(personId)]),
  })
}

/** 카카오 계정 수동 연결 (복구 경로). */
export function useLinkPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (authUserId: string) => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('link_person', { p_person_id: personId, p_auth_user_id: authUserId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => settle(queryClient),
    onError: makeRefreshOnReject(queryClient, [personDetailQueryKey(personId)]),
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
