import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AGENT_NAME, suggestedPrompts } from '../data/dummy';
import type { PromptHandoff } from '../workspace-context';
import { SuggestionStrip } from './SuggestionStrip';
import '../views/HomeView.css';

/**
 * 사무실에서 하루를 누르면 뜨는 간이 대화창 — 새 대화의 입력부(추천 프롬프트 + 입력창)만.
 * 보내면 새 대화를 시작한다(커맨드 바와 같은 넘김 경로 → 세션이 생기고 대화 화면으로 간다).
 */
export function QuickChat({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    const state: PromptHandoff = { prompt };
    navigate('/app/chat/new', { state });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    start(draft);
  };

  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div className="quick-chat" role="dialog" aria-label={`${AGENT_NAME}에게 말하기`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="quick-chat-head">
          <span className="quick-chat-avatar" aria-hidden>
            🤖
          </span>
          <div>
            <strong>{AGENT_NAME}에게 말하기</strong>
            <p>보내면 새 대화가 시작돼요.</p>
          </div>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <SuggestionStrip prompts={suggestedPrompts} onPick={start} />
        <form className="composer" onSubmit={onSubmit}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`${AGENT_NAME}에게 일을 맡겨보세요`}
            aria-label={`${AGENT_NAME}에게 요청`}
          />
          <button type="submit" className="btn is-primary" disabled={!draft.trim()}>
            보내기
          </button>
        </form>
      </div>
    </div>
  );
}
