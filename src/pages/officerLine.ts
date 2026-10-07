/**
 * 처리방침에 적는 담당자 한 줄. 이름·연락처는 교회에서 채우기 전까지 비어 있을 수 있어
 * 비면 역할만 남긴다. (컴포넌트 파일에서 함수를 내보내면 Fast Refresh 가 깨져 별 파일로 둔다.)
 */
export function officerLine(officer: { role: string; name: string; phone: string }): string {
  const name = officer.name ? ` ${officer.name}` : ''
  const phone = officer.phone ? ` · ${officer.phone}` : ''
  return `${officer.role}${name}${phone}`
}
