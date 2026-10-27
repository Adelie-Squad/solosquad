import { useNavigate } from 'react-router-dom';
import { BotAvatar } from '../components/BotAvatar';
import { AGENT_NAME } from '../data/dummy';
import './Landing.css';

const workCards = [
  { icon: '🚚', text: '오늘 출고 86건 송장 등록', className: 'card-a' },
  { icon: '🏭', text: '공장 견적 4건 도착 — 마진 비교 완료', className: 'card-b' },
  { icon: '📣', text: '릴스 초안 2건 — 승인만 하세요', className: 'card-c' },
];

export function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-logo">
          <span className="landing-logo-dot" /> {AGENT_NAME}
        </span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="hero-eyebrow">소규모 커머스를 위한 AI 직원</p>
          <h1>
            일 잘하는 직원 한 명,
            <br />
            <em>{AGENT_NAME}</em>
          </h1>
          <p className="hero-sub">
            정산 · 공장 소싱 · SNS 게시 · 출고까지.
            <br />
            {AGENT_NAME}가 알아서 처리하고, 사장님은 결정만 하세요.
          </p>
          <button className="hero-cta" onClick={() => navigate('/app')}>
            시작하기 <span aria-hidden>→</span>
          </button>
        </div>

        <div className="hero-visual">
          <BotAvatar size={260} />
          {workCards.map((c) => (
            <div key={c.text} className={`work-card ${c.className}`}>
              <span className="work-card-icon">{c.icon}</span>
              {c.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
