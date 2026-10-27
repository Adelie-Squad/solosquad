import { NavLink, useNavigate } from 'react-router-dom';
import { mailMessages, tasks, type CategoryId, type Member, type Space } from '../data/dummy';
import { currentStep, type Job } from '../hooks/useLiveActivity';

interface Props {
  jobs: Job[];
  space: Space;
  viewer: Member;
  canAccess: (category: CategoryId) => boolean;
  workflowAttention: number;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}

const reviewCount = mailMessages.filter((m) => m.needsReview).length;

// Arc 의 상단 즐겨찾기 타일처럼 2×3 고정 메뉴. requires 중 하나라도 권한이 있어야 보인다
const pinned: { to: string; end: boolean; icon: string; label: string; badge: number; requires?: CategoryId[] }[] = [
  { to: '/app', end: true, icon: '🏠', label: '홈', badge: 0 },
  { to: '/app/dashboard', end: false, icon: '📊', label: '대시보드', badge: 0 },
  { to: '/app/mail', end: false, icon: '✉️', label: '메일', badge: reviewCount, requires: ['cs'] },
  { to: '/app/tasks', end: false, icon: '✅', label: 'Task', badge: 0 },
  { to: '/app/scheduler', end: false, icon: '⏰', label: '스케줄러', badge: 0 },
  {
    to: '/app/workflows',
    end: false,
    icon: '🧩',
    label: '워크플로우',
    badge: 0,
    requires: ['finance', 'sourcing', 'marketing'],
  },
];

export function Sidebar({ jobs, space, viewer, canAccess, workflowAttention, onOpenCommand, onOpenSettings }: Props) {
  const navigate = useNavigate();
  const runningCount = jobs.filter((j) => j.status === 'running').length;
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
        <span className="command-pill-text">하루에게 요청하기…</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="pinned" aria-label="주요 메뉴">
        {tiles.map((p) => (
          <NavLink key={p.to} to={p.to} end={p.end} className="pinned-tile">
            <span className="pinned-icon">{p.icon}</span>
            <span className="pinned-label">{p.label}</span>
            {p.badge > 0 && <span className="pinned-badge">{p.badge}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="space-title">
        <span>{space.emoji}</span> {space.name}
      </div>

      <section className="live-section" aria-label="실시간 작업">
        <NavLink to="/app/live" className="live-header">
          <span className="live-dot" />
          실시간 작업
          <span className="live-count">{runningCount}개 진행 중</span>
        </NavLink>

        <ul className="live-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <NavLink to={`/app/live#${job.id}`} className={`live-item is-${job.status}`}>
                <span className="live-item-icon">{job.icon}</span>
                <span className="live-item-body">
                  <span className="live-item-title">{job.title}</span>
                  <span className="live-item-step">{currentStep(job)}</span>
                  {job.status === 'running' && (
                    <span className="live-progress">
                      <span style={{ width: `${job.progress}%` }} />
                    </span>
                  )}
                </span>
                {job.status === 'done' && <span className="live-check">✓</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        <button className="new-request" onClick={onOpenCommand}>
          + 새 요청
        </button>
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
