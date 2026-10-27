import { useState } from 'react';
import {
  AGENT_NAME,
  ownerById,
  ownerOrder,
  tasks as initialTasks,
  type OwnerId,
  type Task,
  type TaskStatus,
} from '../data/dummy';
import { relativeTime } from '../lib/time';
import { useWorkspace } from '../workspace-context';
import './views.css';

type Filter = 'all' | 'owner' | 'agent';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'owner', label: '사장님 할 일' },
  { id: 'agent', label: `${AGENT_NAME}가 맡은 일` },
];

const groups: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: '할 일' },
  { status: 'in_progress', label: '진행 중' },
  { status: 'done', label: '완료' },
];

const priorityChip: Record<Task['priority'], { label: string; className: string } | null> = {
  high: { label: '긴급', className: 'is-danger' },
  normal: null,
  low: null,
};

export function TasksView() {
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<OwnerId | 'all'>('all');
  const { canAccess } = useWorkspace();

  const permitted = tasks.filter((t) => canAccess(t.category));
  const byAssignee = permitted.filter((t) =>
    filter === 'all' ? true : filter === 'owner' ? t.assignee === '사장님' : t.assignee === 'AI',
  );
  // 권한이 바뀌어 고른 카테고리가 사라졌으면 전체로 본다
  const activeCategory = category !== 'all' && canAccess(category) ? category : 'all';
  const visible = byAssignee.filter((t) => activeCategory === 'all' || t.category === activeCategory);

  const toggleDone = (id: string) =>
    setTasks((list) =>
      list.map((t) => (t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t)),
    );

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>Task 목록</h1>
          <p>메일 · 대화 · 스케줄러에서 생긴 일을 한곳에 모았어요.</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          {filters.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'is-active' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="category-filter" role="group" aria-label="업무 카테고리">
          <button
            className={`perm-chip ${activeCategory === 'all' ? 'is-on' : ''}`}
            aria-pressed={activeCategory === 'all'}
            onClick={() => setCategory('all')}
          >
            전체 {byAssignee.length}
          </button>
          {ownerOrder
            .filter(canAccess)
            .map((id) => ownerById[id])
            .map((c) => (
              <button
                key={c.id}
                className={`perm-chip ${activeCategory === c.id ? 'is-on' : ''}`}
                aria-pressed={activeCategory === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.icon} {c.label} {byAssignee.filter((t) => t.category === c.id).length}
              </button>
            ))}
        </div>
      </div>

      {groups.map((g) => {
        const items = visible.filter((t) => t.status === g.status);
        return (
          <section key={g.status} className="task-group">
            <h2 className="panel-title">
              {g.label} <span className="task-count">{items.length}</span>
            </h2>
            <ul className="panel task-list">
              {items.length === 0 && <li className="empty">비어 있어요.</li>}
              {items.map((t) => (
                <li key={t.id} className={`task is-${t.status}`}>
                  <button
                    className="task-check"
                    role="checkbox"
                    aria-checked={t.status === 'done'}
                    aria-label={`${t.title} 완료 표시`}
                    onClick={() => toggleDone(t.id)}
                  >
                    {t.status === 'done' ? '✓' : t.status === 'in_progress' ? '◐' : ''}
                  </button>
                  <span className="task-title">{t.title}</span>
                  {priorityChip[t.priority] && (
                    <span className={`chip ${priorityChip[t.priority]!.className}`}>
                      {priorityChip[t.priority]!.label}
                    </span>
                  )}
                  <span className="chip">
                    {ownerById[t.category].icon} {ownerById[t.category].label}
                  </span>
                  <span className="chip">{t.source}</span>
                  <span className={`chip ${t.assignee === 'AI' ? 'is-accent' : ''}`}>
                    {t.assignee === 'AI' ? `🤖 ${AGENT_NAME}` : '👤 사장님'}
                  </span>
                  <span className="task-due">
                    {t.status === 'done' ? `${relativeTime(t.due)} 완료` : `마감 ${relativeTime(t.due)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
