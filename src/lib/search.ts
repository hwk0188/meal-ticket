/** 번호로 찾을 때 필요한 최소 자릿수. 한 자리면 `010…` 번호 전부에 걸려 명단이 쏟아진다. */
export const SEARCH_MIN_DIGITS = 2

/**
 * 검색 비교용 이름 키: NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리(NFD)로 보낼 수 있다 — lib/fieldSchemas 와 같은 이유).
 * DB 의 `public.normalize_name` 과 같은 규칙이다 — 문장부호는 남긴다. `usePeopleSearch.sanitizeQuery` 는
 * 문장부호까지 지우는 별개 규칙이고, 일부러 합치지 않는다 (4b 리뷰에서 정했다).
 */
export const nameKey = (text: string) => text.normalize('NFC').replace(/\s+/g, '')

/** 숫자만 남긴다. 전각 숫자는 지워진다 — 한국 폰 입력에서는 나오지 않는다고 보고 둔다. */
export const digitsOf = (text: string) => text.replace(/\D/g, '')
