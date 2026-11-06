import { useLinks } from '../scope';
import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ICON, type LucideIcon } from '../icons';
import { useOrgOwner } from '../scope';
import { navHref, visibleNav } from '../shell/nav';

interface Props {
  onClose: () => void;
}

interface Command {
  id: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  run: () => void;
}

/** Hand-off from the command bar or quick chat to a new conversation (location.state). */
export interface PromptHandoff {
  prompt: string;
}

/** Arc-style command bar (Cmd/Ctrl+K): ask Chief anything, or jump to a screen. */
export function CommandBar({ onClose }: Props) {
  const links = useLinks();
  const { w: toWs, o: toOrg } = links;
  const { t } = useI18n();
  const isOwner = useOrgOwner();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const ask = (prompt: string) => {
    const state: PromptHandoff = { prompt };
    navigate(toWs('/chat/new'), { state });
    onClose();
  };
  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  const base: Command[] = [
    { id: 'go-chat', icon: ICON.chat, label: t('chat.new'), hint: t('command.go'), run: () => go(toWs('/chat/new')) },
    ...visibleNav(isOwner).map((n) => ({
      id: `go-${n.to}`,
      icon: n.icon,
      label: t(n.label),
      hint: t('command.go'),
      run: () => go(navHref(n, links)),
    })),
    { id: 'go-connections', icon: ICON.connections, label: t('nav.connections'), hint: t('command.go'), run: () => go(toOrg('/settings/connections')) },
    { id: 'go-settings', icon: ICON.settings, label: t('nav.settings'), hint: t('command.go'), run: () => go(toOrg('/settings')) },
  ];
  const q = query.trim();
  const filtered = q ? base.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : base;
  const commands: Command[] = q
    ? [{ id: 'ask-free', icon: ICON.ask, label: q, hint: t('command.ask'), run: () => ask(q) }, ...filtered]
    : filtered;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(commands.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      commands[cursor]?.run();
    }
  };

  return (
    <div className="command-overlay" onMouseDown={onClose}>
      <div className="command-bar" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('command.open')}>
        <input
          autoFocus
          value={query}
          placeholder={t('command.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul>
          {commands.map((c, i) => (
            <li key={c.id}>
              <button className={i === cursor ? 'is-active' : ''} onMouseEnter={() => setCursor(i)} onClick={c.run}>
                <c.icon className="command-icon" size={18} />
                <span className="command-label">{c.label}</span>
                <span className="command-hint">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
