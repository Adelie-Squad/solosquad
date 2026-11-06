import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useApprovals, useRuns, useThreadState } from '../api/queries';
import type { ChatMessage, RunCreated, ThreadCreated } from '../api/types.gen';
import { ApprovalCard } from '../components/ApprovalCard';
import type { PromptHandoff } from '../components/CommandBar';
import { SuggestionStrip } from '../components/SuggestionStrip';
import { AgentIcon, Mascot } from '../characters/PenguinIcon';
import { useI18n } from '../i18n';
import { useLive } from '../live/LiveProvider';

const TITLE_MAX = 40;

/** The words of a message — tool calls and results are the agents' business, not the chat's. */
export function messageText(m: ChatMessage): string {
  return m.parts
    .filter((p): p is Extract<ChatMessage['parts'][number], { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('');
}

/**
 * Chat with Chief — threads, messages, send, and the answer streaming in live (I9).
 * `/chat/new` is an empty conversation; the first message creates the thread.
 */
export function ChatView() {
  const { tid = 'new' } = useParams<{ tid: string }>();
  const isNew = tid === 'new';
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const live = useLive();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const state = useThreadState(isNew ? undefined : tid);
  const runs = useRuns({ thread_id: tid, limit: 5 }, !isNew);
  const approvals = useApprovals();
  const waiting = (approvals.data ?? []).filter((a) => a.source === 'company' && a.thread_id === tid);
  const messages = (state.data?.values.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && messageText(m).trim(),
  );
  const busy = !isNew && (runs.data ?? []).some((r) => r.status === 'pending' || r.status === 'running');
  const stream = isNew ? undefined : live.streaming[tid];

  const send = async (text: string) => {
    const input = text.trim();
    if (!input || sending) return;
    setSending(true);
    setError(null);
    try {
      let target = tid;
      if (isNew) {
        const title = input.length > TITLE_MAX ? `${input.slice(0, TITLE_MAX)}…` : input;
        target = (await api.post<ThreadCreated>('/threads', { title })).thread_id;
      }
      await api.post<RunCreated>(`/threads/${target}/runs`, { input });
      setDraft('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.threads }),
        qc.invalidateQueries({ queryKey: keys.runs }),
        qc.invalidateQueries({ queryKey: keys.thread(target) }),
      ]);
      if (isNew) navigate(`/chat/${target}`, { replace: true });
    } catch {
      setError(t('chat.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  // a prompt handed over from the command bar or quick chat starts the conversation once
  useEffect(() => {
    const prompt = (location.state as PromptHandoff | null)?.prompt;
    if (isNew && prompt && handled.current !== location.key) {
      handled.current = location.key;
      void send(prompt);
    }
  }, [location.key, isNew]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, stream?.text, waiting.length]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="home">
      <div className="home-scroll">
        <div className="home-inner">
          {isNew && messages.length === 0 && (
            <section className="home-hero">
              <Mascot size={88} />
              <div className="home-bubble">
                <h1>{t('chat.helloTitle')}</h1>
                <p>{t('chat.helloBody')}</p>
              </div>
            </section>
          )}
          {state.error && <p className="form-error">{t('chat.notFound')}</p>}
          {(messages.length > 0 || stream || busy) && (
            <section className="chat" aria-live="polite">
              {messages.map((m) => (
                <div key={m.id} className={`chat-row ${m.role === 'user' ? 'is-user' : 'is-agent'}`}>
                  {m.role !== 'user' && (
                    <span className="chat-avatar">
                      <AgentIcon agent={m.name ?? 'chief'} size={28} label="" />
                    </span>
                  )}
                  <div className="chat-bubble">
                    {m.role !== 'user' && m.name && <span className="chat-name">{m.name}</span>}
                    {messageText(m)}
                  </div>
                </div>
              ))}
              {stream && stream.text && (
                <div className="chat-row is-agent">
                  <span className="chat-avatar">
                    <AgentIcon agent={stream.agent ?? 'chief'} size={28} label="" />
                  </span>
                  <div className="chat-bubble">
                    {stream.agent && <span className="chat-name">{stream.agent}</span>}
                    {stream.text}
                  </div>
                </div>
              )}
              {busy && !stream?.text && (
                <div className="chat-row is-agent">
                  <span className="chat-avatar">
                    <AgentIcon agent="chief" size={28} label="" />
                  </span>
                  <p className="chat-bubble chat-typing" aria-label={t('chat.typing')}>
                    <span />
                    <span />
                    <span />
                  </p>
                </div>
              )}
            </section>
          )}
          {waiting.map((a) => (
            <ApprovalCard key={a.run_id} item={a} compact />
          ))}
          <div ref={end} />
        </div>
      </div>

      <footer className="home-footer">
        {isNew && <SuggestionStrip onPick={(text) => void send(text)} />}
        <form className="composer" onSubmit={onSubmit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isNew ? t('chat.placeholderNew') : t('chat.placeholderMore')}
            aria-label={t('chat.placeholderNew')}
          />
          <button type="submit" className="btn is-primary" disabled={!draft.trim() || sending}>
            {t('chat.send')}
          </button>
        </form>
        <p className="composer-note">{error ?? t('chat.note')}</p>
      </footer>
    </div>
  );
}
