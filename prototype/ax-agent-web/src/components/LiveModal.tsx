import { useEffect } from 'react';
import { AGENT_NAME } from '../data/dummy';
import type { Job } from '../hooks/useLiveActivity';
import { JobList } from './JobList';

const COMPLETED_TODAY_BASE = 23; // 더미: 오늘 이전에 끝난 작업 수

/** 실시간 작업 크게 보기 — 사무실 위에 뜨는 모달. 실시간 작업 화면과 같은 카드(로그 4줄) */
export function LiveModal({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'done').length;

  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div className="live-modal" role="dialog" aria-label="실시간 작업" onMouseDown={(e) => e.stopPropagation()}>
        <header className="live-modal-head">
          <div>
            <h2>
              <span className="live-dot btn-dot" /> 실시간 작업
            </h2>
            <p>{AGENT_NAME}가 지금 하고 있는 일을 단계별로 보여드려요.</p>
          </div>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="live-modal-body">
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
          <JobList jobs={jobs} />
        </div>
      </div>
    </div>
  );
}
