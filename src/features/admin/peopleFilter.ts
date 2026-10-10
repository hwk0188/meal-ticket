import type { Person } from '../auth/usePerson'

/** 목록에 필요한 열만. `useAllPeople` 의 select 문자열과 같은 모양이다. */
export type PersonRow = Pick<Person, 'id' | 'family_id' | 'name' | 'phone' | 'auth_user_id' | 'role' | 'is_minor' | 'guardian_id' | 'created_at'>

/** 화면에 쓰는 태그. "방문자" 는 스키마에 근거가 없어 두지 않는다 (계획 "설계와 다른 점" 참고). */
export type PersonTag = '관리자' | '자녀' | '미가입'
export type DecoratedPerson = PersonRow & { familySize: number; tags: PersonTag[] }
export type PeopleFilter = 'all' | 'unlinked' | 'admin'

/** 검색 비교용 키: NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리(NFD)로 보낼 수 있다 — lib/fieldSchemas 와 같은 이유). */
const nameKey = (text: string) => text.normalize('NFC').replace(/\s+/g, '')
const digits = (text: string) => text.replace(/\D/g, '')

/** 가족 수와 태그를 붙인다. 입력 순서는 그대로 둔다 (정렬은 filterPeople 이 한다). */
export function decoratePeople(rows: readonly PersonRow[]): DecoratedPerson[] {
  const sizeByFamily = new Map<string, number>()
  for (const r of rows) sizeByFamily.set(r.family_id, (sizeByFamily.get(r.family_id) ?? 0) + 1)
  return rows.map((r) => {
    const tags: PersonTag[] = []
    if (r.role === 'admin') tags.push('관리자')
    if (r.is_minor) tags.push('자녀')
    // 자녀는 계정이 없어도 "미가입" 이 아니다 (보호자가 연결해 주는 것이고, 연결 전이면 애초에 사람 행이 없다)
    if (!r.is_minor && !r.auth_user_id) tags.push('미가입')
    return { ...r, familySize: sizeByFamily.get(r.family_id) ?? 1, tags }
  })
}

/** 검색어(이름 일부 또는 번호 뒷자리)와 필터 칩으로 좁히고 이름 순으로 정렬한다. */
export function filterPeople(people: readonly DecoratedPerson[], query: string, filter: PeopleFilter): DecoratedPerson[] {
  const key = nameKey(query)
  const num = digits(query)
  const matched = people.filter((p) => {
    if (filter === 'unlinked' && (p.auth_user_id !== null || p.is_minor)) return false
    if (filter === 'admin' && p.role !== 'admin') return false
    if (!key) return true
    if (nameKey(p.name).includes(key)) return true
    return num.length > 0 && (p.phone ?? '').includes(num)
  })
  return matched.toSorted((a, b) => a.name.localeCompare(b.name, 'ko'))
}
