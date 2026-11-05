import { useState } from 'react';
import { useApprovals } from '../api/queries';
import { ApprovalCard } from '../components/ApprovalCard';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';

type Filter = 'mine' | 'all';

/** Approvals — the companies' guard cards and the workflows' review steps in one list (I10 · I25). */
export function ApprovalsView() {
  const { t } = useI18n();
  const q = useApprovals();
  const [filter, setFilter] = useState<Filter>('mine');
  const all = q.data ?? [];
  const mine = all.filter((a) => a.can_approve);
  const shown = filter === 'mine' ? mine : all;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('approvals.title')}</h1>
          <p>{t('approvals.lead')}</p>
        </div>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={filter === 'mine'} className={filter === 'mine' ? 'is-active' : ''} onClick={() => setFilter('mine')}>
            {t('approvals.mine', { n: mine.length })}
          </button>
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
            {t('approvals.all', { n: all.length })}
          </button>
        </div>
      </header>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : shown.length === 0 ? (
        <div className="panel empty">{t('approvals.none')}</div>
      ) : (
        <div className="stack">
          {shown.map((a) => (
            <ApprovalCard key={`${a.source}-${a.run_id}`} item={a} />
          ))}
        </div>
      )}
    </div>
  );
}
