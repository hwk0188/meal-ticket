import { digitsOf, nameKey, SEARCH_MIN_DIGITS } from './search'

describe('nameKey', () => {
  it('NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리로 보낼 수 있다)', () => {
    expect(nameKey('김 철수')).toBe('김철수')
    expect(nameKey('김철수'.normalize('NFD'))).toBe('김철수')
    expect(nameKey('  이 영 희 ')).toBe('이영희')
  })

  it('문장부호는 남긴다 (DB 의 normalize_name 과 같은 규칙을 지킨다)', () => {
    expect(nameKey('김-철수')).toBe('김-철수')
  })
})

describe('digitsOf', () => {
  it('숫자만 남긴다', () => {
    expect(digitsOf('010-1234-5678')).toBe('01012345678')
    expect(digitsOf('이영희')).toBe('')
  })

  it('전각 숫자는 숫자로 보지 않는다 (\\D 가 지운다 — 알고 쓰는 한계다)', () => {
    expect(digitsOf('１２３')).toBe('')
  })
})

describe('SEARCH_MIN_DIGITS', () => {
  it('두 자리다 — 한 자리면 010… 번호 전부에 걸린다', () => {
    expect(SEARCH_MIN_DIGITS).toBe(2)
  })
})
