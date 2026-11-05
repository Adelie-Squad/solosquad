import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { JobList, type Job } from './JobList';

/** Live work, large — a modal over the office with the full job cards (four log lines). */
export function LiveModal({ jobs, doneToday, onClose }: { jobs: Job[]; doneToday: number; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued' || j.status === 'waiting').length;

  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div className="live-modal" role="dialog" aria-label={t('office.live')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="live-modal-head">
          <div>
            <h2>
              <span className="live-dot btn-dot" /> {t('office.live')}
            </h2>
            <p>{t('office.liveLead')}</p>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="live-modal-body">
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{running}</span>
              <span className="stat-label">{t('job.running')}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{queued}</span>
              <span className="stat-label">{t('job.queued')}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{doneToday}</span>
              <span className="stat-label">{t('office.doneToday')}</span>
            </div>
          </div>
          <JobList jobs={jobs} />
        </div>
      </div>
    </div>
  );
}
