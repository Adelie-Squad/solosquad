import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BotAvatar } from '../components/BotAvatar';
import { SuggestionStrip } from '../components/SuggestionStrip';
import {
  AGENT_NAME,
  cannedReplies,
  fallbackReply,
  reportSinceLastVisit,
  suggestedPrompts,
  type ReportKind,
} from '../data/dummy';
import { useLastVisit } from '../hooks/useLastVisit';
import { greeting, visitLabel } from '../lib/time';
import type { PromptHandoff } from '../workspace-context';
import './HomeView.css';

interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
}

const kindMeta: Record<ReportKind, { label: string; chip: string; icon: string }> = {
  done: { label: '처리 완료', chip: 'is-ok', icon: '✓' },
  attention: { label: '확인 필요', chip: 'is-warn', icon: '!' },
  insight: { label: '인사이트', chip: 'is-accent', icon: '↗' },
};

function replyFor(text: string): string {
  const hit = cannedReplies.find((r) => r.keywords.some((k) => text.includes(k)));
  return hit ? hit.reply : fallbackReply;
}

export function HomeView() {
  const lastVisit = useLastVisit();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const timers = useRef<number[]>([]);
  const handledKey = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((m) => [...m, { id: Date.now(), role: 'user', text: trimmed }]);
    setDraft('');
    setTyping(true);
    const t = window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: Date.now() + 1, role: 'agent', text: replyFor(trimmed) }]);
    }, 900 + Math.random() * 600);
    timers.current.push(t);
  };

  // 커맨드 바에서 넘어온 요청 처리 (같은 navigation 은 한 번만)
  useEffect(() => {
    const handoff = location.state as PromptHandoff | null;
    if (!handoff?.prompt || handledKey.current === location.key) return;
    handledKey.current = location.key;
    send(handoff.prompt);
    navigate(location.pathname, { replace: true, state: null });
    // send·navigate 는 의존성에서 뺀다 — location 이 바뀔 때만 반응하면 된다
  }, [location]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, typing]);

  const counts = reportSinceLastVisit.reduce<Record<ReportKind, number>>(
    (acc, r) => ({ ...acc, [r.kind]: acc[r.kind] + 1 }),
    { done: 0, attention: 0, insight: 0 },
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <div className="home">
      <div className="home-scroll">
        <div className="home-inner">
          <section className="home-hero">
            <BotAvatar size={148} waving />
            <div className="home-bubble">
              <p className="home-greeting">
                사장님, {greeting()}! 👋
              </p>
              <p>
                지난 접속(<strong>{visitLabel(lastVisit)}</strong>) 이후 {AGENT_NAME}가 처리한 일을 정리했어요.
              </p>
            </div>
          </section>

          <section className="panel report">
            <header className="report-header">
              <h2 className="panel-title">지난 접속 이후 보고</h2>
              <div className="report-counts">
                {(Object.keys(kindMeta) as ReportKind[]).map((k) => (
                  <span key={k} className={`chip ${kindMeta[k].chip}`}>
                    {kindMeta[k].label} {counts[k]}
                  </span>
                ))}
              </div>
            </header>
            <ul className="report-list">
              {reportSinceLastVisit.map((r) => (
                <li key={r.id} className={`report-item is-${r.kind}`}>
                  <span className={`report-icon chip ${kindMeta[r.kind].chip}`}>{kindMeta[r.kind].icon}</span>
                  <div>
                    <p className="report-title">{r.title}</p>
                    <p className="report-detail">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {messages.length > 0 && (
            <section className="chat" aria-live="polite">
              {messages.map((m) => (
                <div key={m.id} className={`chat-row is-${m.role}`}>
                  {m.role === 'agent' && <span className="chat-avatar">🤖</span>}
                  <p className="chat-bubble">{m.text}</p>
                </div>
              ))}
              {typing && (
                <div className="chat-row is-agent">
                  <span className="chat-avatar">🤖</span>
                  <p className="chat-bubble chat-typing">
                    <span />
                    <span />
                    <span />
                  </p>
                </div>
              )}
              <div ref={chatEnd} />
            </section>
          )}
        </div>
      </div>

      {/* 하단 고정 — 위 영역만 스크롤된다 */}
      <footer className="home-footer">
        <SuggestionStrip prompts={suggestedPrompts} onPick={send} />
        <form className="composer" onSubmit={onSubmit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`${AGENT_NAME}에게 일을 맡겨보세요`}
            aria-label={`${AGENT_NAME}에게 요청`}
          />
          <button type="submit" className="btn is-primary" disabled={!draft.trim()}>
            보내기
          </button>
        </form>
      </footer>
    </div>
  );
}
