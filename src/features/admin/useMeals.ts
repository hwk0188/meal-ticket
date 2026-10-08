import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { MealValues } from './mealSchema'

export const mealsQueryKey = ['meals'] as const
export const adminBalancesQueryKey = ['admin-balances'] as const

/** 모든 식사, 최근 날짜부터 (교인도 읽을 수 있지만 쓰는 곳은 관리자 화면·발급 화면) */
export function useMeals() {
  return useQuery({
    queryKey: mealsQueryKey,
    queryFn: async () => supabase.from('meals').select('*').order('served_on', { ascending: false }).then(unwrap),
  })
}

/** 관리자가 보는 모든 가족의 잔량 (RLS 가 관리자에게 전부 연다) */
export function useAdminBalances() {
  return useQuery({
    queryKey: adminBalancesQueryKey,
    queryFn: async () => supabase.from('ticket_balances').select('*').then(unwrap),
  })
}

export function useCreateNextSundayLunch() {
  const queryClient = useQueryClient()
  return useMutation({
    // 이 RPC 는 순차 재호출마다 "다음" 일요일을 만든다(동시 클릭만 수렴). 자동 재시도 금지 — App 의 mutations.retry=0 을 바꾸지 말 것.
    mutationFn: async () => supabase.rpc('create_next_sunday_lunch').then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealsQueryKey }),
  })
}

export function useAddMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    // created_by 는 DB 기본값(현재 관리자). 열 권한에도 없으니 보내지 않는다.
    mutationFn: async (values: MealValues) => supabase.from('meals').insert(values).select().single().then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealsQueryKey }),
  })
}

export function useDeleteMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    // 발급이 있으면 FK 가 23503 으로 막는다 → toUserMessage 가 문구로 바꾼다
    mutationFn: async (id: string) => supabase.from('meals').delete().eq('id', id).then(unwrap),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mealsQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
      ]),
  })
}
