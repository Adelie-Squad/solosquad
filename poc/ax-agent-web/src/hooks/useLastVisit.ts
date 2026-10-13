const KEY = 'ax-agent-web.lastVisit';

// 페이지 로드당 한 번만 읽고 기록한다. (StrictMode 의 이중 렌더나 뷰 전환으로
// 두 번째 호출이 일어나도 "방금 기록한 현재 시각"을 직전 접속으로 오인하지 않도록)
let previousVisit: string | null = null;

/**
 * 직전 접속 시각을 돌려주고, 현재 시각을 다음 접속용으로 기록한다.
 * 첫 방문이면 '어제 오후 6:12'를 직전 접속으로 가정한다(더미 보고를 자연스럽게 보이게).
 */
export function useLastVisit(): string {
  if (previousVisit === null) {
    const stored = localStorage.getItem(KEY);
    localStorage.setItem(KEY, new Date().toISOString());
    if (stored) {
      previousVisit = stored;
    } else {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - 1);
      fallback.setHours(18, 12, 0, 0);
      previousVisit = fallback.toISOString();
    }
  }
  return previousVisit;
}
