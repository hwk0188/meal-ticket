import { decoratePeople, filterPeople, type PersonRow } from './peopleFilter'

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})

describe('decoratePeople', () => {
  it('가족 수를 세고 태그를 붙인다 (관리자·자녀·미가입)', () => {
    const list = decoratePeople([
      row({ id: 'p1' }),
      row({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
      row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f2', role: 'admin' }),
      row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f3', auth_user_id: null }),
    ])
    expect(list.map((p) => p.name)).toEqual(['김철수', '서연', '권사', '이순자'])
    expect(list[0]).toMatchObject({ familySize: 2, tags: [] })
    expect(list[1]!.tags).toEqual(['자녀'])
    expect(list[2]).toMatchObject({ familySize: 1, tags: ['관리자'] })
    expect(list[3]!.tags).toEqual(['미가입'])
  })

  it('가족이 1명이면 가족 수 태그를 쓰지 않도록 familySize 는 그대로 1 로 둔다', () => {
    expect(decoratePeople([row({})])[0]).toMatchObject({ familySize: 1 })
  })
})

describe('filterPeople', () => {
  const list = decoratePeople([
    row({ id: 'p1', name: '김철수', phone: '01012345678' }),
    row({ id: 'p2', name: '이영희', phone: '01098765432', family_id: 'f2' }),
    row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f3', role: 'admin' }),
    row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f4', auth_user_id: null }),
    row({ id: 'p5', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
  ])

  it('빈 검색어 + 전체 필터는 이름 순으로 전부', () => {
    expect(filterPeople(list, '', 'all').map((p) => p.name)).toEqual(['권사', '김철수', '서연', '이순자', '이영희'])
  })

  it('이름 일부로 찾는다 (NFD 로 들어온 자모도 맞춘다)', () => {
    expect(filterPeople(list, '영희', 'all').map((p) => p.name)).toEqual(['이영희'])
    expect(filterPeople(list, '영희'.normalize('NFD'), 'all').map((p) => p.name)).toEqual(['이영희'])
  })

  it('번호 뒷자리로 찾는다 (하이픈·공백은 무시)', () => {
    expect(filterPeople(list, '5678', 'all').map((p) => p.name)).toEqual(['김철수'])
    expect(filterPeople(list, '010-1234', 'all').map((p) => p.name)).toEqual(['김철수'])
  })

  it('미가입 필터는 계정 없는 사람만 (자녀는 계정이 있어도 제외하지 않는다 — 자녀는 미가입이 아니다)', () => {
    expect(filterPeople(list, '', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })

  it('관리자 필터는 관리자만', () => {
    expect(filterPeople(list, '', 'admin').map((p) => p.name)).toEqual(['권사'])
  })

  it('필터와 검색어는 함께 걸린다', () => {
    expect(filterPeople(list, '이', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })
})
