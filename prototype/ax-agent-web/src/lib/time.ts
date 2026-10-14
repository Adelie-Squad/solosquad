const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "방금", "3분 전", "2시간 후", "어제" 같은 상대 시간 */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? '전' : '후';
  if (abs < MIN) return diff < 0 ? '방금' : '곧';
  if (abs < HOUR) return `${Math.round(abs / MIN)}분 ${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}시간 ${suffix}`;
  const days = Math.round(abs / DAY);
  if (days === 1) return diff < 0 ? '어제' : '내일';
  return `${days}일 ${suffix}`;
}

/** "어제 오후 6:12" / "10월 12일 오전 9:05" */
export function visitLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return `오늘 ${time}`;
  if (d.getTime() >= startOfToday - DAY) return `어제 ${time}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 11) return '좋은 아침이에요';
  if (h < 17) return '좋은 오후예요';
  return '오늘도 수고 많으셨어요';
}
