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
 *  1) 잔량(뷰) · 오늘 식사 · 가족 구성원  2) 식사 상세(오늘 제외한 id 목록) · 오늘 식사의 사용 기록
 * 뷰·people·usages 는 관리자가 보면 모든 가족이 보이므로(RLS) family_id 로 좁힌다.
 */
export function useFamilyTickets(person: Person) {
  const today = todaySeoul()
  return useQuery({
    queryKey: [...ticketsQueryKey, person.family_id, today],
    queryFn: async (): Promise<FamilyTickets> => {
      // 화면이 폴링하는 동안 자정을 넘겨도(위 today 는 렌더 시점 값) 다음 폴링은 새 날짜로 읽는다.
      // 결과가 바뀌면 리렌더로 queryKey 의 today 도 뒤따라 바뀐다.
      const day = todaySeoul()
      const [balances, todayMeals, members] = await Promise.all([
        supabase.from('ticket_balances').select('*').eq('family_id', person.family_id).then(unwrap),
        supabase.from('meals').select('*').eq('served_on', day).then(unwrap),
        supabase.from('people').select('id, name').eq('family_id', person.family_id).is('deleted_at', null).then(unwrap),
      ])
      const todayIds = todayMeals.map((m) => m.id)
      // 오늘 식사는 이미 받았으니 2차 왕복에서 다시 받지 않는다.
      const mealIds = [...new Set(balances.map((b) => b.meal_id).filter((id): id is string => id !== null))].filter(
        (id) => !todayIds.includes(id),
      )
      const [restMeals, usages] = await Promise.all([
        mealIds.length ? supabase.from('meals').select('*').in('id', mealIds).then(unwrap) : Promise.resolve<Meal[]>([]),
        todayIds.length
          ? supabase
              .from('usages')
              .select('*')
              .eq('family_id', person.family_id)
              .in('meal_id', todayIds)
              .is('voided_at', null)
              .order('used_at')
              .then(unwrap)
          : Promise.resolve<Usage[]>([]),
      ])
      const meals = [...todayMeals, ...restMeals]
      return { ...groupTickets(meals, balances, day), usages, members }
    },
    refetchInterval: TICKETS_POLL_MS,
  })
}
