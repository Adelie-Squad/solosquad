import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BotAvatar } from '../components/BotAvatar';
import { SuggestionStrip } from '../components/SuggestionStrip';
import {
  AGENT_NAME,
  cannedReplies,
  fallbackReply,
  reportSinceLastVisit,
  suggestedPrompts,
  type ChatMessage,
  type ReportKind,
} from '../data/dummy';
import { useLastVisit } from '../hooks/useLastVisit';
import { BUSINESS_CONTEXT, llmChat, useLlm, type LlmMessage } from '../lib/llm';
import { greeting, relativeTime, visitLabel } from '../lib/time';
import { useWorkspace, type PromptHandoff } from '../workspace-context';
import './HomeView.css';

const TITLE_MAX = 22;
/** 실제 AI 에 함께 보내는 지난 메시지 수 */
const HISTORY_MAX = 10;

const kindMeta: Record<ReportKind, { label: string; chip: string; icon: string }> = {
  done: { label: '처리 완료', chip: 'is-ok', icon: '✓' },
  attention: { label: '확인 필요', chip: 'is-warn', icon: '!' },
  insight: { label: '인사이트', chip: 'is-accent', icon: '↗' },
};

function replyFor(text: string): string {
  const hit = cannedReplies.find((r) => r.keywords.some((k) => text.includes(k)));
  return hit ? hit.reply : fallbackReply;
}

/**
 * 하루와 대화 — `/app/chat/new` 는 예전 홈(인사 · 보고 · 추천 프롬프트), 첫 메시지를 보내면
 * 세션이 생겨 `/app/chat/:id` 로 바뀐다. 세션은 셸 상태라 사이드바 목록과 같이 움직인다.
 */
export function HomeView() {
  const { id = 'new' } = useParams<{ id: string }>();
  const lastVisit = useLastVisit();
  const { viewer, sessions, setSessions } = useWorkspace();
  const llm = useLlm();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  // 답을 기다리는 세션 — 다른 대화로 옮겨 가도 그 세션에만 타이핑 표시가 남는다
  const [typingFor, setTypingFor] = useState<string | null>(null);
  const handledKey = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === id) ?? null;
  const messages = session?.messages ?? [];
  const typing = session !== null && typingFor === session.id;

  const append = (sid: string, message: ChatMessage) =>
    setSessions((list) =>
      list.map((s) => (s.id === sid ? { ...s, updatedAt: new Date().toISOString(), messages: [...s.messages, message] } : s)),
    );

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMessage: ChatMessage = { id: `m-${Date.now()}`, role: 'user', text: trimmed };
    let sid = session?.id;
    if (!sid) {
      sid = `chat-${Date.now()}`;
      const title = trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX)}…` : trimmed;
      setSessions((list) => [{ id: sid!, title, updatedAt: new Date().toISOString(), messages: [userMessage] }, ...list]);
      navigate(`/app/chat/${sid}`, { replace: true });
    } else {
      append(sid, userMessage);
    }
    setDraft('');
    setTypingFor(sid);
    const target = sid;
    const reply = (text: string) => {
      setTypingFor((cur) => (cur === target ? null : cur));
      append(target, { id: `m-${Date.now()}`, role: 'agent', text });
    };

    // 키가 있으면 오픈라우터로, 없거나 실패하면 키워드 더미 응답.
    // 셸 상태를 바꾸므로 화면을 떠나도 답은 도착해야 한다 — 언마운트 시 취소하지 않는다
    if (llm?.configured) {
      const history: LlmMessage[] = (session?.messages ?? []).slice(-HISTORY_MAX).map((m) => ({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content: m.text,
      }));
      llmChat([{ role: 'system', content: BUSINESS_CONTEXT }, ...history, { role: 'user', content: trimmed }])
        .then(reply)
        .catch((err: Error) => reply(`${replyFor(trimmed)}\n\n(실제 AI 연결에 실패해 데모 응답을 보여드렸어요 — ${err.message})`));
      return;
    }
    window.setTimeout(() => reply(replyFor(trimmed)), 900 + Math.random() * 600);
  };

  // 커맨드 바에서 넘어온 요청 처리 (같은 navigation 은 한 번만). send 가 새 세션 주소로 바꾸면서 state 도 비운다
  useEffect(() => {
    const handoff = location.state as PromptHandoff | null;
    if (!handoff?.prompt || handledKey.current === location.key) return;
    handledKey.current = location.key;
    send(handoff.prompt);
    // send 는 의존성에서 뺀다 — location 이 바뀔 때만 반응하면 된다
  }, [location]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typing, id]);

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
          {session ? (
            <header className="chat-head">
              <h1>{session.title}</h1>
              <p>
                {AGENT_NAME}와의 대화 · {relativeTime(session.updatedAt)} · 메시지 {session.messages.length}개
              </p>
            </header>
          ) : (
            <>
              <section className="home-hero">
                <BotAvatar size={148} waving />
                <div className="home-bubble">
                  <p className="home-greeting">
                    {viewer.master ? '사장님' : `${viewer.name} 님`}, {greeting()}! 👋
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
            </>
          )}

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

      {/* 하단 고정 — 위 영역만 스크롤된다. 추천 프롬프트는 새 대화에서만 */}
      <footer className="home-footer">
        {!session && <SuggestionStrip prompts={suggestedPrompts} onPick={send} />}
        <form className="composer" onSubmit={onSubmit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={session ? `${AGENT_NAME}에게 이어서 말하기` : `${AGENT_NAME}에게 일을 맡겨보세요`}
            aria-label={`${AGENT_NAME}에게 요청`}
          />
          <button type="submit" className="btn is-primary" disabled={!draft.trim()}>
            보내기
          </button>
        </form>
        <p className="composer-note">
          {llm?.configured
            ? `실제 AI 응답 · 오픈라우터 ${llm.model}${llm.daily ? ` · 오늘 남은 무료 호출 ${llm.daily.remaining}/${llm.daily.limit}회` : ''}`
            : llm?.error === 'invalid_key'
              ? '데모 응답이에요 — 오픈라우터가 키를 거절했어요. 저장소 루트 .env 의 OPENROUTER_API_KEY 를 확인해 주세요'
              : '데모 응답이에요 — 저장소 루트 .env 에 OPENROUTER_API_KEY 를 넣으면 실제 AI 가 답해요'}
        </p>
      </footer>
    </div>
  );
}
