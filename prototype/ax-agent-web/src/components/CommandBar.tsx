import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AGENT_NAME, suggestedPrompts } from '../data/dummy';
import type { PromptHandoff } from '../workspace-context';

interface Props {
  onClose: () => void;
}

interface Command {
  id: string;
  icon: string;
  label: string;
  hint: string;
  run: () => void;
}

/** Arc 의 커맨드 바(⌘T) 처럼 화면 중앙에 뜨는 요청·이동 입력창 */
export function CommandBar({ onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const ask = (prompt: string) => {
    const state: PromptHandoff = { prompt };
    navigate('/app', { state });
    onClose();
  };
  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  const base: Command[] = [
    ...suggestedPrompts.map((p) => ({
      id: p.id,
      icon: p.icon,
      label: p.text,
      hint: `${AGENT_NAME}에게 요청`,
      run: () => ask(p.text),
    })),
    { id: 'go-home', icon: '🏠', label: '홈', hint: '이동', run: () => go('/app') },
    { id: 'go-office', icon: '🏢', label: '사무실', hint: '이동', run: () => go('/app/office') },
    { id: 'go-dash', icon: '📊', label: '대시보드', hint: '사무실 › 이동', run: () => go('/app/office/dashboard') },
    { id: 'go-wf', icon: '🧩', label: '워크플로우', hint: '이동', run: () => go('/app/workflows') },
    { id: 'go-live', icon: '🟢', label: '실시간 작업', hint: '이동', run: () => go('/app/live') },
    { id: 'go-mail', icon: '✉️', label: '메일 연동', hint: '이동', run: () => go('/app/mail') },
    { id: 'go-tasks', icon: '✅', label: 'Task 목록', hint: '이동', run: () => go('/app/tasks') },
    { id: 'go-sched', icon: '⏰', label: '자동화 스케줄러', hint: '이동', run: () => go('/app/scheduler') },
  ];
  const q = query.trim();
  const filtered = q ? base.filter((c) => c.label.includes(q)) : base;
  // 입력한 문장 그대로 요청하는 항목을 맨 위에
  const commands: Command[] = q
    ? [{ id: 'ask-free', icon: '✨', label: q, hint: `${AGENT_NAME}에게 요청`, run: () => ask(q) }, ...filtered]
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
      <div className="command-bar" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="커맨드 바">
        <input
          autoFocus
          value={query}
          placeholder={`${AGENT_NAME}에게 요청하거나 메뉴로 이동…`}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul>
          {commands.map((c, i) => (
            <li key={c.id}>
              <button
                className={i === cursor ? 'is-active' : ''}
                onMouseEnter={() => setCursor(i)}
                onClick={c.run}
              >
                <span className="command-icon">{c.icon}</span>
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
