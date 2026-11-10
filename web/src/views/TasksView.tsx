import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAction, useApprovals, useArtifacts, useKeys, useScopedApi, useWork } from '../api/queries';
import type { Artifact, WorkEntry } from '../api/types.gen';
import { ApprovalCard } from '../components/ApprovalCard';
import { Loading, QueryError } from '../components/Status';
import { AgentIcon } from '../characters/PenguinIcon';
import { kindLabel, useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { useAgentName } from '../lib/agentNames';
import { agentsIn, endedAt, filterDone, groupTasks, type DoneFilter, type Period, type WorkKind } from '../lib/tasks';
import { useLinks } from '../scope';
import { RUN_STATUS } from './WorkflowsView';

const PERIODS: { id: Period; label: MessageKey }[] = [
  { id: 'today', label: 'tasks.period.today' },
  { id: 'week', label: 'tasks.period.week' },
  { id: 'month', label: 'tasks.period.month' },
  { id: 'all', label: 'tasks.period.all' },
];

const KINDS: { id: WorkKind; label: MessageKey }[] = [
  { id: 'all', label: 'tasks.kind.all' },
  { id: 'chat', label: 'tasks.kind.chat' },
  { id: 'workflow', label: 'tasks.kind.workflow' },
  { id: 'artifact', label: 'tasks.kind.artifact' },
];

/** Where a piece of work opens: its conversation, or its workflow run. */
export function workHref(w: Pick<WorkEntry, 'source' | 'workflow' | 'thread_id'>, toWs: (p?: string) => string): string {
  return w.source === 'workflow' && w.workflow ? toWs(`/workflows/${w.workflow}/runs/${w.thread_id}`) : toWs(`/chat/${w.thread_id}`);
}

/**
 * Task (2026-11-07 — approvals + work products + agent work in one screen): first what this
 * person has to do (approve · decline · check), then cards that wait for someone else, then
 * what the agents are on now, then what they finished and made.
 */
export function TasksView() {
  const { t } = useI18n();
  const approvals = useApprovals();
  const reviews = useArtifacts({ needs_review: true, limit: 50 });
  const work = useWork({ limit: 150 });
  const loading = approvals.isPending || work.isPending;
  const error = approvals.error ?? work.error;
  const groups = groupTasks(approvals.data ?? [], reviews.data ?? [], work.data?.items ?? []);
  const mineCount = groups.mine.approvals.length + groups.mine.reviews.length;
  const { hash } = useLocation();

  // the dashboard's numbers link to a group (#todo · #running · #done)
  useEffect(() => {
    if (!loading && hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash, loading]);

  return (
    <div className="view tasks">
      <header className="view-header">
        <div>
          <h1>{t('nav.tasks')}</h1>
          <p>{t('tasks.lead')}</p>
        </div>
      </header>
      {loading ? (
        <Loading />
      ) : error ? (
        <QueryError error={error} />
      ) : (
        <>
          <section className="task-section" id="todo" aria-labelledby="todo-title" data-testid="group-mine">
            <SectionHead id="todo-title" title={t('tasks.mine')} count={mineCount} tone="warn" />
            {mineCount === 0 ? (
              <p className="panel empty is-inline">{t('tasks.mineNone')}</p>
            ) : (
              <div className="stack">
                {groups.mine.approvals.map((a) => (
                  <ApprovalCard key={`${a.source}-${a.run_id}`} item={a} />
                ))}
                {groups.mine.reviews.map((r) => (
                  <ReviewCard key={r.id} artifact={r} />
                ))}
              </div>
            )}
          </section>

          {groups.others.length > 0 && (
            <section className="task-section" id="others" aria-labelledby="others-title" data-testid="group-others">
              <SectionHead id="others-title" title={t('tasks.others')} count={groups.others.length} />
              <p className="task-section-lead">{t('tasks.othersLead')}</p>
              <div className="stack">
                {groups.others.map((a) => (
                  <ApprovalCard key={`${a.source}-${a.run_id}`} item={a} />
                ))}
              </div>
            </section>
          )}

          <section className="task-section" id="running" aria-labelledby="running-title" data-testid="group-running">
            <SectionHead id="running-title" title={t('tasks.running')} count={groups.running.length} tone="accent" />
            {groups.running.length === 0 ? (
              <p className="panel empty is-inline">{t('tasks.runningNone')}</p>
            ) : (
              <ul className="panel work-list" aria-live="polite">
                {groups.running.map((w) => (
                  <WorkRow key={w.thread_id} item={w} />
                ))}
              </ul>
            )}
          </section>

          <DoneSection items={groups.done} />
        </>
      )}
    </div>
  );
}

function SectionHead({ id, title, count, tone }: { id: string; title: string; count: number; tone?: 'warn' | 'accent' }) {
  return (
    <header className="section-head">
      <h2 className="panel-title with-count" id={id}>
        {title}
        {count > 0 && <span className={`chip ${tone ? `is-${tone}` : ''}`}>{count}</span>}
      </h2>
    </header>
  );
}

/** A work product waiting to be checked — open it, or mark it checked right here. */
export function ReviewCard({ artifact: a, from }: { artifact: Artifact; from?: ReactNode }) {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { ws: wsApi } = useScopedApi();
  const { t, fmt, locale } = useI18n();
  const review = useAction(() => wsApi.post<Artifact>(`/artifacts/${a.id}/review`), [keys.artifacts, keys.work, keys.digest]);
  return (
    <article className="panel approval-card review-card" data-testid="review-card">
      <header className="approval-card-head">
        <span className="review-icon">
          <ICON.artifacts size={20} />
        </span>
        <strong className="approval-title">{a.title}</strong>
        <span className="approval-chips">
          <span className="chip">{kindLabel(locale, a.kind)}</span>
          <span className="chip is-warn">{t('artifact.needsReviewShort')}</span>
        </span>
      </header>
      <p className="approval-meta">
        {a.workflow ? t('approvals.fromWorkflow', { name: a.workflow }) : t('tasks.kind.artifact')}
        {from && (
          <>
            {' · '}
            {from}
          </>
        )}
        {' · '}
        {fmt.relative(a.created)}
      </p>
      <div className="approval-actions">
        <button className="btn is-primary with-icon" disabled={review.isPending} onClick={() => review.mutate(undefined)}>
          <ICON.check />
          {t('artifact.markReviewed')}
        </button>
        <Link className="btn with-icon" to={toWs(`/tasks/artifacts/${a.id}`)}>
          {t('widget.open')}
          <ICON.more />
        </Link>
      </div>
      {review.error && <p className="form-error">{t('common.failed')}</p>}
    </article>
  );
}

/** One piece of agent work as a row: who · what · where it is · what it made. */
export function WorkRow({ item: w, from }: { item: WorkEntry; from?: ReactNode }) {
  const { w: toWs } = useLinks();
  const { t, fmt } = useI18n();
  const nameOf = useAgentName();
  const status = RUN_STATUS[w.status];
  const open = w.status === 'pending' || w.status === 'running' || w.status === 'interrupted';
  const lead = w.agents[0];
  const pct = w.steps ? Math.round(((w.step ?? 0) / w.steps) * 100) : null;
  return (
    <li className="work-row" data-testid="work-row">
      <span className="work-who">
        {lead ? <AgentIcon agent={lead} size={28} label="" /> : <span className="review-icon"><ICON.workflows size={18} /></span>}
      </span>
      <span className="work-body">
        <Link className="work-title" to={workHref(w, toWs)}>
          {w.title || t('chat.untitled')}
        </Link>
        <span className="work-meta">
          <span>{w.source === 'workflow' ? t('tasks.kind.workflow') : t('tasks.kind.chat')}</span>
          {w.cron && <span>{t('tasks.scheduled')}</span>}
          {w.agents.length > 0 && <span>{w.agents.map(nameOf).join(', ')}</span>}
          {from && <span>{from}</span>}
          <span className="is-time">{fmt.relative(open ? w.created : endedAt(w))}</span>
        </span>
        {open && w.steps != null && (
          <span className="work-progress">
            <span className="work-step">
              {t('tasks.step', { n: (w.step ?? 0) + 1, total: w.steps })}
              {w.current_step ? ` · ${w.current_step}` : ''}
            </span>
            <span className="job-bar" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={w.title ?? ''}>
              <span style={{ width: `${pct ?? 0}%` }} />
            </span>
          </span>
        )}
        {w.artifacts.length > 0 && (
          <span className="work-made">
            {w.artifacts.map((a) => (
              <Link key={a.id} className="chip work-artifact" to={toWs(`/tasks/artifacts/${a.id}`)}>
                <ICON.artifacts size={12} />
                {a.title}
                {a.needs_review && <span className="work-artifact-flag">{t('artifact.needsReviewShort')}</span>}
              </Link>
            ))}
          </span>
        )}
      </span>
      <span className={`chip ${status.chip}`}>{t(status.label)}</span>
    </li>
  );
}

function DoneSection({ items }: { items: WorkEntry[] }) {
  const { t } = useI18n();
  const nameOf = useAgentName();
  const [filter, setFilter] = useState<DoneFilter>({ period: 'week', agent: '', kind: 'all' });
  const shown = filterDone(items, filter, new Date());
  const agents = agentsIn(items);
  const set = (patch: Partial<DoneFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <section className="task-section" id="done" aria-labelledby="done-title" data-testid="group-done">
      <SectionHead id="done-title" title={t('tasks.done')} count={0} />
      <div className="task-filters" role="group" aria-label={t('tasks.filters')}>
        <div className="segmented" role="tablist" aria-label={t('tasks.period')}>
          {PERIODS.map((p) => (
            <button key={p.id} role="tab" aria-selected={filter.period === p.id} className={filter.period === p.id ? 'is-active' : ''} onClick={() => set({ period: p.id })}>
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="segmented" role="tablist" aria-label={t('tasks.kind')}>
          {KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={filter.kind === k.id} className={filter.kind === k.id ? 'is-active' : ''} onClick={() => set({ kind: k.id })}>
              {t(k.label)}
            </button>
          ))}
        </div>
        {agents.length > 0 && (
          <select className="task-agent" aria-label={t('tasks.agent')} value={filter.agent} onChange={(e) => set({ agent: e.target.value })}>
            <option value="">{t('tasks.agentAll')}</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {nameOf(a)}
              </option>
            ))}
          </select>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="panel empty is-inline">{t('tasks.doneNone')}</p>
      ) : (
        <ul className="panel work-list">
          {shown.map((w) => (
            <WorkRow key={w.thread_id} item={w} />
          ))}
        </ul>
      )}
    </section>
  );
}
