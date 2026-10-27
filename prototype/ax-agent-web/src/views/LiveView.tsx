import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AGENT_NAME, ownerById } from '../data/dummy';
import { currentStep, type Job } from '../hooks/useLiveActivity';
import { tokens } from '../lib/format';
import { relativeTime } from '../lib/time';
import { useWorkspace } from '../workspace-context';
import './views.css';

const COMPLETED_TODAY_BASE = 23; // 더미: 오늘 이전에 끝난 작업 수

const statusChip: Record<Job['status'], { label: string; className: string }> = {
  running: { label: '진행 중', className: 'is-accent' },
  queued: { label: '대기', className: '' },
  done: { label: '완료', className: 'is-ok' },
};

function stepState(job: Job, index: number): 'done' | 'current' | 'pending' {
  if (job.status === 'done') return 'done';
  if (job.status === 'queued') return 'pending';
  const current = job.steps.indexOf(currentStep(job));
  if (index < current) return 'done';
  return index === current ? 'current' : 'pending';
}

export function LiveView() {
  const { jobs } = useWorkspace();
  const { hash } = useLocation();
  const focusId = hash.slice(1);

  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId]);

  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'done').length;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>실시간 작업</h1>
          <p>{AGENT_NAME}가 지금 하고 있는 일을 단계별로 보여드려요.</p>
        </div>
      </header>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{running}</span>
          <span className="stat-label">진행 중</span>
        </div>
        <div className="stat">
          <span className="stat-value">{queued}</span>
          <span className="stat-label">대기</span>
        </div>
        <div className="stat">
          <span className="stat-value">{COMPLETED_TODAY_BASE + done}</span>
          <span className="stat-label">오늘 완료</span>
        </div>
      </div>

      <div className="job-list">
        {jobs.map((job) => (
          <article
            key={job.id}
            id={job.id}
            className={`panel job is-${job.status} ${job.id === focusId ? 'is-focused' : ''}`}
          >
            <header className="job-header">
              <span className="job-icon">{job.icon}</span>
              <div className="job-heading">
                <h2>{job.title}</h2>
                <span className="job-meta">
                  {ownerById[job.category].icon} {job.category === 'haru' ? ownerById.haru.label : `${ownerById[job.category].label} 에이전트`} ·{' '}
                  {job.status === 'queued' ? '곧 시작해요' : `${relativeTime(job.startedAt)} 시작`}
                  {job.tokens > 0 && ` · ${tokens(job.tokens)} 토큰`}
                </span>
              </div>
              <span className={`chip ${statusChip[job.status].className}`}>{statusChip[job.status].label}</span>
              <span className="job-percent">{Math.round(job.progress)}%</span>
            </header>

            <div className="job-bar">
              <span style={{ width: `${job.progress}%` }} />
            </div>

            <ol className="steps">
              {job.steps.map((step, i) => (
                <li key={step} className={`step is-${stepState(job, i)}`}>
                  {step}
                </li>
              ))}
            </ol>

            {job.log.length > 0 && (
              <ul className="job-log">
                {job.log
                  .slice(-4)
                  .reverse()
                  .map((line, i) => (
                    <li key={`${line.at}-${i}`}>
                      <time>{new Date(line.at).toLocaleTimeString('ko-KR', { hour12: false })}</time>
                      {line.text}
                    </li>
                  ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
