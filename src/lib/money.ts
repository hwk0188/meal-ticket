/** 5000 → '5,000원' */
export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}
