import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { church } from '../../config/church'
import { codeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { signOut } from '../auth/signIn'
import { personQueryKey, type Person } from '../auth/usePerson'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { familyMembersQueryKey } from './useFamilyMembers'

/**
 * 가족 구성이 바뀌면 다시 읽어야 하는 것 전부: 구성원 목록, 홈(구성원 수·식권 — 어른 합류 때 잔량 풀이 옮겨 올 수 있다),
 * 내역, 내 사람 행(가족 나가기·합류로 family_id 가 바뀐다 — 키 접두사 ['person'] 으로 모든 사용자 캐시).
 * ['pairing-code', …] 는 절대 건드리지 않는다 — invalidateQueries 는 staleTime 과 무관하게 활성 쿼리를 다시 부르고,
 * create_pairing_code 는 부를 때마다 이전 코드를 지우므로 상대가 적던 코드가 죽는다. 항상 명시적 키만 쓴다.
 */
export function invalidateFamily(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: familyMembersQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    queryClient.invalidateQueries({ queryKey: ['person'] }),
  ])
}

/** 자녀 추가: 아이 폰의 코드 + 이름. 돌려받는 행은 새 자녀. */
export function useAddChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; code: string }) =>
      // 동의 버전: 보호자가 체크한 법정대리인 동의 문구의 날짜 (DB 가 YYYY-MM-DD 형식을 검사한다)
      unwrap(await supabase.rpc('add_family_member', { p_code: v.code, p_child_name: v.name, p_consent_version: church.consentVersion })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 폰을 바꾼 자녀를 새 폰의 코드로 다시 연결 */
export function useRelinkChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { childId: string; code: string }) =>
      unwrap(await supabase.rpc('relink_child', { p_child_id: v.childId, p_code: v.code })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 어른 합류: 상대(배우자) 폰의 어른 코드 → 그 사람이 우리 가족으로 들어온다 */
export function useJoinFamily() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { code: string }) => unwrap(await supabase.rpc('add_family_member', { p_code: v.code })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 가족 나가기: 나와 내 자녀만 새 가족으로. 장부는 옛 가족에 남는다. */
export function useLeaveFamily() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('leave_family')),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 자녀 삭제(익명화) */
export function useRemoveChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (childId: string) => unwrap(await supabase.rpc('remove_child', { p_child_id: childId })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/**
 * 탈퇴: 익명화 뒤 로그아웃. 로그아웃이 세션·캐시를 비우고 Gate 가 시작 화면을 띄운다. has_children 이면 여기서 멈춘다.
 * onSuccess/onSettled 에서 캐시를 무효화하지 않는다 — 그 콜백은 signOut() 직후 마이크로태스크로 돌아서 AuthProvider 의
 * (한 틱 미룬) clear 보다 먼저 실행되고, 이미 폐기된 토큰으로 401 재조회를 쏘게 된다.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('delete_my_account'))
      await signOut()
    },
  })
}

/** 내 정보 수정(이름·번호). people_update_self 정책이 본인 행의 이 두 열만 연다. */
export function useUpdateProfile(me: Pick<Person, 'id' | 'auth_user_id'>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; phone: string }): Promise<Person> => {
      const row = unwrap(await supabase.from('people').update(v).eq('id', me.id).select('*').single())
      // .single() 의 타입은 null 을 허용하지만(런타임 응답 안전망) 한 행 update·select 는 항상 행을 돌려준다.
      if (!row) throw new Error('useUpdateProfile: 바뀐 사람 행을 받지 못했습니다')
      return row
    },
    onSuccess: (row) => {
      // 홈 머리말·가드가 보는 내 사람 행을 바로 바꿔 끼우고, 구성원 목록은 다시 읽는다
      if (me.auth_user_id) queryClient.setQueryData(personQueryKey(me.auth_user_id), row)
      return queryClient.invalidateQueries({ queryKey: familyMembersQueryKey })
    },
  })
}

/** 내 정보 수정 오류 문구. 번호 중복(부분 유니크 인덱스 23505)은 구체적으로. */
export function profileErrorMessage(err: unknown): string {
  return codeOf(err) === '23505' ? '이미 다른 분이 쓰는 번호예요. 번호를 확인하거나 권사님께 문의해 주세요.' : toUserMessage(err)
}
