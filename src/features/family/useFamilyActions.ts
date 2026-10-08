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
 * ['pairing-code', …] 는 절대 건드리지 않는다 — TanStack 5.104 에서 'static' 쿼리는 invalidateQueries 로도
 * 다시 부르지 않지만(usePairingCode 참고), 그래도 키 목록은 항상 명시적으로 둔다 (버전·설정이 바뀌어도 안전하도록 방어선을 겹쳐 둔다).
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

/** 탈퇴 결과. signedOut=false 면 익명화는 끝났지만 로그아웃만 실패한 것 — 화면은 "앱을 닫고 다시 열어 주세요" 로 안내한다. */
export type DeleteAccountResult = { signedOut: boolean }

/**
 * 탈퇴: 익명화 뒤 로그아웃. 로그아웃이 세션·캐시를 비우고 Gate 가 시작 화면을 띄운다. has_children 이면 여기서 멈춘다.
 * onSuccess/onSettled 에서 캐시를 무효화하지 않는다 — 그 콜백은 signOut() 직후 마이크로태스크로 돌아서 AuthProvider 의
 * (한 틱 미룬) clear 보다 먼저 실행되고, 이미 폐기된 토큰으로 401 재조회를 쏘게 된다.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<DeleteAccountResult> => {
      unwrap(await supabase.rpc('delete_my_account'))
      try {
        await signOut()
        return { signedOut: true }
      } catch (error) {
        // 익명화는 이미 커밋됐다 — 오류로 올리면 '다시 시도' 가 뜨고 두 번째 시도는 not_registered 가 된다.
        // 세션은 아직 살아 있으므로(SIGNED_OUT 없음) 내 사람 행만 다시 읽게 해 가드가 가입 화면으로 보내게 한다.
        console.error('탈퇴 뒤 로그아웃 실패', error)
        await queryClient.invalidateQueries({ queryKey: ['person'] })
        return { signedOut: false }
      }
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
      // 홈 머리말·가드가 보는 내 사람 행을 바로 바꿔 끼우고, 가족 쪽도 다시 읽는다
      // (이름은 식권 라벨·내역에도 보이고, 번호가 바뀌면 캐시된 구성원 목록도 낡은 값을 보여 준다)
      if (me.auth_user_id) queryClient.setQueryData(personQueryKey(me.auth_user_id), row)
      return invalidateFamily(queryClient)
    },
  })
}

/** 내 정보 수정 오류 문구. 번호 중복(부분 유니크 인덱스 23505)은 구체적으로. */
export function profileErrorMessage(err: unknown): string {
  return codeOf(err) === '23505' ? '이미 다른 분이 쓰는 번호예요. 번호를 확인하거나 권사님께 문의해 주세요.' : toUserMessage(err)
}
