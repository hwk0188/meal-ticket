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
      // 계정이 끊긴 자녀 (auth_user_id 는 on delete set null — 폰을 바꾼 자녀가 여기 들어온다)
      row({ id: 'p6', name: '서진', phone: null, is_minor: true, guardian_id: 'p1', family_id: 'f4', auth_user_id: null }),
      // 번호로 올린 관리자가 아직 가입을 안 한 경우 (README 의 승격 절차는 계정을 요구하지 않는다)
      row({ id: 'p7', name: '박권사', phone: '01022223333', family_id: 'f5', role: 'admin', auth_user_id: null }),
    ])
    expect(list.map((p) => p.name)).toEqual(['김철수', '서연', '권사', '이순자', '서진', '박권사'])
    expect(list[0]).toMatchObject({ familySize: 2, tags: [] })
    expect(list[1]!.tags).toEqual(['자녀'])
    expect(list[2]).toMatchObject({ familySize: 1, tags: ['관리자'] })
    expect(list[3]!.tags).toEqual(['미가입'])
    expect(list[4]!.tags).toEqual(['자녀'])
    expect(list[5]!.tags).toEqual(['관리자', '미가입'])
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
    row({ id: 'p6', name: '서진', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: null }),
  ])

  it('빈 검색어 + 전체 필터는 이름 순으로 전부', () => {
    expect(filterPeople(list, '', 'all').map((p) => p.name)).toEqual(['권사', '김철수', '서연', '서진', '이순자', '이영희'])
  })

  it('받은 배열을 건드리지 않는다 (화면이 React Query 캐시 배열을 그대로 넘긴다)', () => {
    const before = list.map((p) => p.id)
    filterPeople(list, '', 'all')
    expect(list.map((p) => p.id)).toEqual(before)
  })

  it('이름이 같으면 id 로 순서를 고정한다 (조회마다 자리가 바뀌면 합치기 대상이 바뀐다)', () => {
    const same = decoratePeople([
      row({ id: 'pB', name: '김철수', phone: '01088887777', family_id: 'f8' }),
      row({ id: 'pA', name: '김철수', phone: '01077776666', family_id: 'f9' }),
    ])
    expect(filterPeople(same, '', 'all').map((p) => p.id)).toEqual(['pA', 'pB'])
    expect(filterPeople(same.toReversed(), '', 'all').map((p) => p.id)).toEqual(['pA', 'pB'])
  })

  it('이름 일부로 찾는다 (NFD 로 들어온 자모도 맞춘다)', () => {
    expect(filterPeople(list, '영희', 'all').map((p) => p.name)).toEqual(['이영희'])
    expect(filterPeople(list, '영희'.normalize('NFD'), 'all').map((p) => p.name)).toEqual(['이영희'])
  })

  it('번호 뒷자리로 찾는다 (하이픈·공백은 무시)', () => {
    expect(filterPeople(list, '5678', 'all').map((p) => p.name)).toEqual(['김철수'])
    expect(filterPeople(list, '010-1234', 'all').map((p) => p.name)).toEqual(['김철수'])
  })

  it('숫자 한 자리로는 번호를 찾지 않는다 (010… 전부가 걸려 명단이 쏟아진다)', () => {
    expect(filterPeople(list, '1', 'all')).toEqual([])
    expect(filterPeople(list, '김1', 'all')).toEqual([])
  })

  it('미가입 필터는 계정 없는 어른만 (자녀는 계정이 없어도 미가입이 아니다)', () => {
    expect(filterPeople(list, '', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })

  it('관리자 필터는 관리자만', () => {
    expect(filterPeople(list, '', 'admin').map((p) => p.name)).toEqual(['권사'])
  })

  it('필터와 검색어는 함께 걸린다', () => {
    expect(filterPeople(list, '이', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })
})
