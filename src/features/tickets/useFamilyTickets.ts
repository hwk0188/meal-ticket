import { useQuery } from '@tanstack/react-query'
import { todaySeoul } from '../../lib/dates'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'
import { groupTickets, type Meal, type TicketGroups, type Usage } from './groupTickets'

/** 화면이 보이는 동안의 재조회 주기 (설계 §8.2). 숨겨지면 멈추고(refetchIntervalInBackground=false), 돌아오면 즉시 다시 읽는다(refetchOnWindowFocus). */
export const TICKETS_POLL_MS = 5_000

export const ticketsQueryKey = ['tickets'] as const

export type Member = Pick<Person, 'id' | 'name'>
export type FamilyTickets = TicketGroups & { usages: Usage[]; members: Member[] }

/**
 * 우리 가족 식권 전체. 두 번의 왕복으로 끝낸다:
 *  1) 잔량(뷰) · 오늘 식사 · 가족 구성원  2) 식사 상세(id 목록) · 오늘 식사의 사용 기록
 * 뷰는 meals 임베딩이 안 되고(coalesce 열), 관리자는 뷰·people 에서 모든 가족을 보므로 family_id 로 좁힌다.
 */
export function useFamilyTickets(person: Person) {
  const today = todaySeoul()
  return useQuery({
    queryKey: [...ticketsQueryKey, person.family_id, today],
    queryFn: async (): Promise<FamilyTickets> => {
      const [balances, todayMeals, members] = await Promise.all([
        supabase.from('ticket_balances').select('*').eq('family_id', person.family_id).then(unwrap),
        supabase.from('meals').select('*').eq('served_on', today).then(unwrap),
        supabase.from('people').select('id, name').eq('family_id', person.family_id).is('deleted_at', null).then(unwrap),
      ])
      const mealIds = [
        ...new Set([...balances.map((b) => b.meal_id).filter((id): id is string => id !== null), ...todayMeals.map((m) => m.id)]),
      ]
      // 뷰의 .eq 는 이미 서버에서 걸리지만, 한 번 더 좁혀 사용 기록 조회 범위를 오늘 식사로만 묶는다.
      const todayIds = todayMeals.filter((m) => m.served_on === today).map((m) => m.id)
      const [meals, usages] = await Promise.all([
        mealIds.length ? supabase.from('meals').select('*').in('id', mealIds).then(unwrap) : Promise.resolve<Meal[]>([]),
        todayIds.length
          ? supabase.from('usages').select('*').in('meal_id', todayIds).is('voided_at', null).order('used_at').then(unwrap)
          : Promise.resolve<Usage[]>([]),
      ])
      return { ...groupTickets(meals, balances, today), usages, members }
    },
    refetchInterval: TICKETS_POLL_MS,
  })
}
