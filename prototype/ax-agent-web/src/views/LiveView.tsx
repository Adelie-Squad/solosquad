import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { JobList } from '../components/JobList';
import { AGENT_NAME } from '../data/dummy';
import { useWorkspace } from '../workspace-context';
import './views.css';

const COMPLETED_TODAY_BASE = 23; // 더미: 오늘 이전에 끝난 작업 수

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

      <JobList jobs={jobs} focusId={focusId} />
    </div>
  );
}
