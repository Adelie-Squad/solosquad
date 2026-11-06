import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';
import { AgentIcon } from '../characters/PenguinIcon';
import type { LogLine } from '../live/LiveProvider';

/** A job card's view of one run — built from the API (runs, workflows) plus live notes. */
export interface Job {
  id: string;
  /** The penguin on the card: the agent (or, for a workflow, its team's scarf penguin). */
  agent: string;
  team?: string | null;
  title: string;
  who: string;
  status: 'running' | 'queued' | 'waiting' | 'done';
  startedAt: number | null;
  /** Known steps (workflows); empty for a conversation, which has no fixed plan. */
  steps: string[];
  stepIndex: number;
  log: LogLine[];
  link?: string;
}

const statusChip: Record<Job['status'], { label: MessageKey; className: string }> = {
  running: { label: 'job.running', className: 'is-accent' },
  queued: { label: 'job.queued', className: '' },
  waiting: { label: 'job.waiting', className: 'is-warn' },
  done: { label: 'job.done', className: 'is-ok' },
};

function stepState(job: Job, index: number): 'done' | 'current' | 'pending' {
  if (job.status === 'done') return 'done';
  if (job.status === 'queued') return 'pending';
  if (index < job.stepIndex) return 'done';
  return index === job.stepIndex ? 'current' : 'pending';
}

export function progressOf(job: Job): number | null {
  if (!job.steps.length) return null;
  if (job.status === 'done') return 100;
  return Math.round((Math.min(job.stepIndex, job.steps.length) / job.steps.length) * 100);
}

/**
 * Live job cards (ported from the prototype) — the office panel and the large modal share it.
 * `compact` keeps two log lines. Steps fold to the current one; the chevron unfolds them.
 */
export function JobList({ jobs, compact }: { jobs: Job[]; compact?: boolean }) {
  const { t, fmt } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (jobs.length === 0) return <div className="panel empty">{t('job.none')}</div>;

  return (
    <div className={`job-list ${compact ? 'is-compact' : ''}`}>
      {jobs.map((job) => {
        const pct = progressOf(job);
        const now = Math.min(job.stepIndex, Math.max(0, job.steps.length - 1));
        return (
          <article key={job.id} className={`panel job is-${job.status}`}>
            <header className="job-header">
              <span className="job-icon">
                <AgentIcon agent={job.agent} team={job.team} size={28} label="" />
              </span>
              <div className="job-heading">
                <h2>{job.link ? <Link to={job.link}>{job.title}</Link> : job.title}</h2>
                <span className="job-meta">
                  {job.who}
                  {job.startedAt ? ` · ${t('job.started', { when: fmt.relative(job.startedAt) })}` : ''}
                </span>
              </div>
              <span className={`chip ${statusChip[job.status].className}`}>{t(statusChip[job.status].label)}</span>
              {pct !== null && <span className="job-percent">{pct}%</span>}
            </header>

            <div className={`job-bar ${pct === null && job.status === 'running' ? 'is-indeterminate' : ''}`}>
              <span style={{ width: `${pct ?? (job.status === 'running' ? 40 : 0)}%` }} />
            </div>

            {job.steps.length > 0 && (
              <div className="step-row">
                {expanded.has(job.id) ? (
                  <ol className="steps is-vertical">
                    {job.steps.map((step, i) => (
                      <li key={`${step}-${i}`} className={`step is-${stepState(job, i)}`}>
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ol className="steps" style={{ counterReset: `step ${now}` }}>
                    <li className={`step is-${stepState(job, now)}`}>{job.steps[now]}</li>
                  </ol>
                )}
                <span className="step-count">
                  {now + 1}/{job.steps.length}
                </span>
                <button
                  className="step-toggle"
                  aria-expanded={expanded.has(job.id)}
                  aria-label={expanded.has(job.id) ? t('job.fold') : t('job.unfold')}
                  title={expanded.has(job.id) ? t('job.fold') : t('job.unfold')}
                  onClick={() => toggle(job.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                    <path d="M3 5.5 L7 9.5 L11 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}

            {job.log.length > 0 && (
              <ul className="job-log">
                {job.log
                  .slice(compact ? -2 : -4)
                  .reverse()
                  .map((line, i) => (
                    <li key={`${line.at}-${i}`}>
                      <time>{fmt.time(line.at / 1000)}</time>
                      {line.text}
                    </li>
                  ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
