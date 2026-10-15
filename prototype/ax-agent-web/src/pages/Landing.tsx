import { useNavigate } from 'react-router-dom';
import { BotAvatar } from '../components/BotAvatar';
import { AGENT_NAME } from '../data/dummy';
import './Landing.css';

const workCards = [
  { icon: '✉️', text: '주문 문의 12건 답장 완료', className: 'card-a' },
  { icon: '📦', text: '버터 재고 부족 — 발주서 준비됨', className: 'card-b' },
  { icon: '💬', text: '리뷰 7건 답글 등록', className: 'card-c' },
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
          <p className="hero-eyebrow">소규모 비즈니스를 위한 AI 직원</p>
          <h1>
            사장님 옆에
            <br />
            일 잘하는 직원 한 명, <em>{AGENT_NAME}</em>
          </h1>
          <p className="hero-sub">
            메일 응대, 리뷰 답글, 재고 확인, 매출 정리까지.
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
