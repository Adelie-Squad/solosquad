import './WorkerAvatar.css';

export type WorkerStatus = 'working' | 'waiting' | 'idle';

interface Props {
  color: string;
  status: WorkerStatus;
  size?: number;
  /** 마스터(하루) — 왕관 안테나 */
  master?: boolean;
}

/**
 * 사무실의 워커 에이전트. 마스코트(BotAvatar)와 구분되는 작은 로봇 —
 * 몸 색은 부서 색, 상태에 따라 타이핑 · 손 들기 · 깜빡임 모션.
 */
export function WorkerAvatar({ color, status, size = 56, master }: Props) {
  return (
    <svg
      className={`worker is-${status}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      style={{ ['--worker' as string]: color }}
    >
      {/* 안테나 */}
      <line x1="32" y1="9" x2="32" y2="15" stroke="var(--worker)" strokeWidth="2.5" strokeLinecap="round" />
      {master ? (
        <path d="M24 9 L27 3 L32 7 L37 3 L40 9 Z" fill="#f5b83d" />
      ) : (
        <circle className="worker-antenna" cx="32" cy="7" r="3" fill="var(--worker)" />
      )}

      {/* 몸 */}
      <rect x="18" y="40" width="28" height="18" rx="8" fill="var(--worker)" />
      {/* 팔 — working 이면 번갈아 타이핑, waiting 이면 오른팔을 든다 */}
      <rect className="worker-arm is-left" x="12" y="43" width="7" height="12" rx="3.5" fill="var(--worker)" />
      <rect className="worker-arm is-right" x="45" y="43" width="7" height="12" rx="3.5" fill="var(--worker)" />

      {/* 머리 */}
      <rect x="14" y="14" width="36" height="28" rx="11" fill="#ffffff" stroke="var(--worker)" strokeWidth="2.5" />
      <rect x="19" y="19" width="26" height="17" rx="7" fill="#1f2340" />
      <g className="worker-eyes">
        <rect x="24" y="24" width="5" height="6" rx="2.5" fill="#9ff3e1" />
        <rect x="35" y="24" width="5" height="6" rx="2.5" fill="#9ff3e1" />
      </g>
    </svg>
  );
}
