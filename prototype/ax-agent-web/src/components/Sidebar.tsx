import { NavLink, useNavigate } from 'react-router-dom';
import { AGENT_NAME, mailMessages, tasks, type ChatSession, type Member, type OwnerId, type Space } from '../data/dummy';
import { relativeTime } from '../lib/time';

interface Props {
  sessions: ChatSession[];
  space: Space;
  viewer: Member;
  canAccess: (owner: OwnerId) => boolean;
  workflowAttention: number;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}

const reviewCount = mailMessages.filter((m) => m.needsReview).length;

// Arc 의 상단 즐겨찾기 타일처럼 2×3 고정 메뉴. requires 중 하나라도 권한이 있어야 보인다
const pinned: { to: string; icon: string; label: string; badge: number; requires?: OwnerId[] }[] = [
  { to: '/app/office', icon: '🏢', label: '사무실', badge: 0 },
  { to: '/app/dashboard', icon: '📊', label: '대시보드', badge: 0 },
  { to: '/app/mail', icon: '✉️', label: '메일', badge: reviewCount, requires: ['haru'] },
  { to: '/app/tasks', icon: '✅', label: 'Task', badge: 0 },
  { to: '/app/scheduler', icon: '⏰', label: '스케줄러', badge: 0 },
  { to: '/app/workflows', icon: '🧩', label: '워크플로우', badge: 0, requires: ['finance', 'sourcing', 'marketing'] },
];

export function Sidebar({ sessions, space, viewer, canAccess, workflowAttention, onOpenCommand, onOpenSettings }: Props) {
  const navigate = useNavigate();
  const ownerTodoCount = tasks.filter(
    (t) => t.assignee === '사장님' && t.status !== 'done' && canAccess(t.category),
  ).length;
  const tiles = pinned
    .filter((p) => !p.requires || p.requires.some(canAccess))
    .map((p) =>
      p.to === '/app/tasks'
        ? { ...p, badge: ownerTodoCount }
        : p.to === '/app/workflows'
          ? { ...p, badge: workflowAttention }
          : p,
    );
  const recent = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="history">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="뒤로">
            ←
          </button>
          <button className="icon-btn" onClick={() => navigate(1)} aria-label="앞으로">
            →
          </button>
        </div>
      </div>

      <button className="command-pill" onClick={onOpenCommand}>
        <span className="command-pill-text">{AGENT_NAME}에게 요청하기…</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="pinned" aria-label="주요 메뉴">
        {tiles.map((p) => (
          <NavLink key={p.to} to={p.to} className="pinned-tile">
            <span className="pinned-icon">{p.icon}</span>
            <span className="pinned-label">{p.label}</span>
            {p.badge > 0 && <span className="pinned-badge">{p.badge}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="space-title">
        <span>{space.emoji}</span> {space.name}
      </div>

      {/* 하루와 나눈 대화 — Arc 의 탭 목록 자리 */}
      <section className="chat-section" aria-label={`${AGENT_NAME}와 대화`}>
        <div className="chat-section-head">
          <span>💬 {AGENT_NAME}와 대화</span>
          <span className="live-count">{sessions.length}개</span>
        </div>

        <button className="new-request" onClick={() => navigate('/app/chat/new')}>
          + 새 대화
        </button>

        <ul className="session-list">
          {recent.map((s) => (
            <li key={s.id}>
              <NavLink to={`/app/chat/${s.id}`} className="session-item">
                <span className="session-title">{s.title}</span>
                <span className="session-meta">
                  {relativeTime(s.updatedAt)} · 메시지 {s.messages.length}개
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </section>

      <div className="sidebar-bottom">
        <button className="viewer-chip" onClick={onOpenSettings} title="팀원 · 권한 설정">
          <span>{viewer.emoji}</span>
          <span className="viewer-chip-name">{viewer.name}</span>
          <span className="viewer-chip-role">{viewer.master ? '마스터' : viewer.role}</span>
        </button>
        <button className="icon-btn" aria-label="설정" title="설정" onClick={onOpenSettings}>
          ⚙️
        </button>
      </div>
    </aside>
  );
}
