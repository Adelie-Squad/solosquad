import { ownerById } from '../data/dummy';
import { currentStep, type Job } from '../hooks/useLiveActivity';
import { tokens } from '../lib/format';
import { relativeTime } from '../lib/time';
import '../views/views.css';

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

/** 실시간 작업 카드 목록 — 실시간 작업 화면과 사무실의 오른쪽 패널이 같이 쓴다. compact 는 로그를 2줄로 줄인다 */
export function JobList({ jobs, focusId, compact }: { jobs: Job[]; focusId?: string; compact?: boolean }) {
  return (
    <div className={`job-list ${compact ? 'is-compact' : ''}`}>
      {jobs.map((job) => (
        <article key={job.id} id={job.id} className={`panel job is-${job.status} ${job.id === focusId ? 'is-focused' : ''}`}>
          <header className="job-header">
            <span className="job-icon">{job.icon}</span>
            <div className="job-heading">
              <h2>{job.title}</h2>
              <span className="job-meta">
                {ownerById[job.category].icon}{' '}
                {job.category === 'haru' ? ownerById.haru.label : `${ownerById[job.category].label} 에이전트`} ·{' '}
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
                .slice(compact ? -2 : -4)
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
  );
}
