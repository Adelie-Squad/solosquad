import './BotAvatar.css';

interface Props {
  size?: number;
  /** 손 흔들기 — 서비스 페이지 첫 진입 인사에 사용 */
  waving?: boolean;
}

/** AI 직원 '하루' 그래픽. 둥실 떠 있고 눈을 깜빡인다. */
export function BotAvatar({ size = 160, waving = false }: Props) {
  return (
    <div className="bot" style={{ width: size, height: size }} aria-hidden>
      <div className="bot-glow" />
      <svg className="bot-body" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="bot-head" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#ece7ff" />
          </linearGradient>
          <linearGradient id="bot-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b2350" />
            <stop offset="100%" stopColor="#1a1533" />
          </linearGradient>
        </defs>

        {/* 안테나 */}
        <line x1="100" y1="38" x2="100" y2="22" stroke="#cfc6f5" strokeWidth="5" strokeLinecap="round" />
        <circle className="bot-antenna" cx="100" cy="18" r="8" fill="var(--accent)" />

        {/* 머리 */}
        <rect x="34" y="38" width="132" height="112" rx="44" fill="url(#bot-head)" stroke="#e2dbff" strokeWidth="2" />
        {/* 얼굴 화면 */}
        <rect x="52" y="58" width="96" height="66" rx="30" fill="url(#bot-face)" />
        {/* 눈 */}
        <g className="bot-eyes">
          <rect x="74" y="78" width="14" height="22" rx="7" fill="#9ff3e1" />
          <rect x="112" y="78" width="14" height="22" rx="7" fill="#9ff3e1" />
        </g>
        {/* 볼 */}
        <circle cx="66" cy="108" r="6" fill="#ff9fc4" opacity="0.7" />
        <circle cx="134" cy="108" r="6" fill="#ff9fc4" opacity="0.7" />

        {/* 몸통 */}
        <rect x="68" y="150" width="64" height="34" rx="16" fill="url(#bot-head)" stroke="#e2dbff" strokeWidth="2" />
        <circle cx="100" cy="167" r="6" fill="var(--accent)" opacity="0.85" />

        {/* 팔 */}
        <rect x="44" y="152" width="18" height="28" rx="9" fill="#f4f0ff" stroke="#e2dbff" strokeWidth="2" />
        <g className={waving ? 'bot-arm-wave' : undefined}>
          <rect x="138" y="152" width="18" height="28" rx="9" fill="#f4f0ff" stroke="#e2dbff" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}
