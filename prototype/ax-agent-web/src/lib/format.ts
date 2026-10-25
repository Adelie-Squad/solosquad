/** 1,840,000원 */
export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 1,438만원 — 카드 · 막대 라벨처럼 좁은 자리 */
export function wonShort(n: number): string {
  if (Math.abs(n) < 10_000) return won(n);
  return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`;
}

/** 74K · 3.8M 토큰 */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}
