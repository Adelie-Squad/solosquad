import { useLinks } from '../scope';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import type { PromptHandoff } from './CommandBar';
import { SuggestionStrip } from './SuggestionStrip';
import { AgentIcon } from '../characters/PenguinIcon';

/** Quick chat — opens over the office when Chief is clicked; sending starts a new conversation. */
export function QuickChat({ agent, onClose }: { agent: string; onClose: () => void }) {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
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
    navigate(toWs('/chat/new'), { state });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    start(draft);
  };

  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div className="quick-chat" role="dialog" aria-label={t('chat.talkTo', { name: agent })} onMouseDown={(e) => e.stopPropagation()}>
        <header className="quick-chat-head">
          <span className="quick-chat-avatar" aria-hidden>
            <AgentIcon agent={agent} size={40} label="" />
          </span>
          <div>
            <strong>{t('chat.talkTo', { name: agent })}</strong>
            <p>{t('chat.quickHint')}</p>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <ICON.close size={18} />
          </button>
        </header>
        <SuggestionStrip onPick={start} />
        <form className="composer" onSubmit={onSubmit}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('chat.placeholderNew')}
            aria-label={t('chat.placeholderNew')}
          />
          <button type="submit" className="btn is-primary" disabled={!draft.trim()}>
            {t('chat.send')}
          </button>
        </form>
      </div>
    </div>
  );
}
