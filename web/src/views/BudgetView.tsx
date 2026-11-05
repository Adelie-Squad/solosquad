import { useBudget } from '../api/queries';
import type { BudgetLine } from '../api/types.gen';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';

export function BudgetBar({ label, line }: { label: string; line: BudgetLine }) {
  const { t, fmt } = useI18n();
  const pct = line.budget_usd ? Math.min(100, (line.spent_usd / line.budget_usd) * 100) : null;
  const state = line.exhausted ? 'is-danger' : line.warning ? 'is-warn' : 'is-ok';
  return (
    <div className="budget-line">
      <div className="budget-head">
        <strong>{label}</strong>
        <span>
          {fmt.usd(line.spent_usd)}
          {line.budget_usd != null ? ` / ${fmt.usd(line.budget_usd)}` : ` · ${t('budget.noCap')}`}
        </span>
        {line.exhausted ? (
          <span className="chip is-danger">{t('budget.exhausted')}</span>
        ) : line.warning ? (
          <span className="chip is-warn">{t('budget.warning')}</span>
        ) : null}
      </div>
      {pct !== null && (
        <div className={`budget-bar ${state}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** This month's spend — the org cap and each connection's (I14 · W13). */
export function BudgetView() {
  const { t, fmt } = useI18n();
  const q = useBudget();
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('budget.title')}</h1>
          <p>{q.data ? t('budget.lead', { since: fmt.date(q.data.month_start), pct: Math.round(q.data.warn_at * 100) }) : ''}</p>
        </div>
      </header>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : (
        <section className="panel stack">
          <BudgetBar label={t('budget.org')} line={q.data.org} />
          {q.data.connections.map((c) => (
            <BudgetBar key={c.id} label={c.id} line={c} />
          ))}
        </section>
      )}
    </div>
  );
}
