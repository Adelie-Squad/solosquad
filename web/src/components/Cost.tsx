import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useBudget } from '../api/queries';
import type { BudgetLine, BudgetSuggestion } from '../api/types.gen';
import { useI18n } from '../i18n';
import { Loading, QueryError } from './Status';

/** One spend line: what was spent of its cap, with the warning or the cap reached. */
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

/**
 * What Chief suggests next to a warning (C9): move the work to a connection with room, or a
 * monthly cap for this month's pace. The engine decides (I14); the web only words it, and
 * nothing is applied by itself. `name` turns a line's subject (a connection id, or `null`
 * for the company line) into the words on screen.
 */
export function BudgetSuggestions({ items, name }: { items: BudgetSuggestion[]; name: (subject: string | null) => string }) {
  const { t, fmt } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="cost-suggest" data-testid="budget-suggestions">
      <h3 className="cost-sub">{t('budget.suggestTitle')}</h3>
      <ul className="cost-suggest-list">
        {items.map((s, i) => (
          <li key={i} data-kind={s.kind}>
            {s.kind === 'switch_connection'
              ? t('budget.suggestSwitch', { from: name(s.subject), to: s.to_connection ?? '' })
              : t('budget.suggestRaise', { subject: name(s.subject), amount: fmt.usd(s.budget_usd ?? 0) })}
          </li>
        ))}
      </ul>
      <p className="dash-hint">{t('budget.suggestHint')}</p>
    </div>
  );
}

/**
 * The cost area of the dashboard (2026-11-07 — the cost screen moved here, I14 · W13): this
 * month's spend for the whole company and for each connection, with the warning line and the
 * caps. `#cost` (the old cost address lands there) scrolls it into view.
 */
export function CostSection() {
  const { t, fmt } = useI18n();
  const q = useBudget();
  const ref = useRef<HTMLElement>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === '#cost' && q.data) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hash, q.data]);

  return (
    <section className="panel widget cost" id="cost" ref={ref} aria-labelledby="cost-title" data-testid="cost">
      <header className="widget-head">
        <h2 className="panel-title" id="cost-title">
          {t('budget.title')}
        </h2>
      </header>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : (
        <>
          <p className="cost-lead">{t('budget.lead', { since: fmt.date(q.data.month_start), pct: Math.round(q.data.warn_at * 100) })}</p>
          <div className="cost-org">
            <BudgetBar label={t('budget.org')} line={q.data.org} />
          </div>
          {q.data.connections.length > 0 && (
            <>
              <h3 className="cost-sub">{t('budget.byConnection')}</h3>
              <div className="cost-conns">
                {q.data.connections.map((c) => (
                  <BudgetBar key={c.id} label={c.id} line={c} />
                ))}
              </div>
            </>
          )}
          <BudgetSuggestions items={q.data.suggestions} name={(id) => id ?? t('budget.org')} />
        </>
      )}
    </section>
  );
}
