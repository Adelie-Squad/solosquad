import type { PnlData } from '../api/types.gen';
import { useI18n } from '../i18n';
import { ICON } from '../icons';

/** Profit and loss (`finance.pnl`, W14) — totals, by month, by account, rows to check.
 * Numbers come from the engine's deterministic tool; account names are shown as written. */
export function PnlView({ data, compact = false }: { data: PnlData; compact?: boolean }) {
  const { t, fmt } = useI18n();
  const money = (n: number) => fmt.money(n, data.currency);
  const max = Math.max(1, ...data.by_month.map((m) => Math.max(m.revenue, m.expenses)));
  const revenue = data.by_account.filter((a) => a.type === 'revenue');
  const expenses = data.by_account.filter((a) => a.type === 'expense');

  return (
    <div className="pnl">
      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{money(data.revenue)}</span>
          <span className="stat-label">{t('pnl.revenue')}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{money(data.expenses)}</span>
          <span className="stat-label">{t('pnl.expenses')}</span>
        </div>
        <div className="stat">
          <span className={`stat-value ${data.net_income < 0 ? 'is-negative' : ''}`}>{money(data.net_income)}</span>
          <span className="stat-label">{t('pnl.net')}</span>
        </div>
      </div>
      <p className="dash-hint">
        {t('pnl.period', { period: data.period ?? t('pnl.unknownPeriod') })} · {t('pnl.rows', { n: data.rows })}
      </p>

      {data.by_month.length > 0 && (
        <section className="dash-section">
          <h3 className="dash-panel-title">{t('pnl.byMonth')}</h3>
          {!compact && (
            <div className="vbars pnl-bars" aria-hidden>
              {data.by_month.map((m) => (
                <div key={m.month} className="vbar" title={`${m.month} · ${money(m.revenue)} / ${money(m.expenses)}`}>
                  <span className="vbar-value">{fmt.number(m.net)}</span>
                  <span className="vbar-fill" style={{ height: `${(m.revenue / max) * 100}%` }} />
                  <span className="vbar-fill is-cost" style={{ height: `${(m.expenses / max) * 100}%` }} />
                  <span className="vbar-label">{m.month}</span>
                </div>
              ))}
            </div>
          )}
          <div className="statement-wrap">
            <table className="statement">
              <thead>
                <tr>
                  <th>{t('pnl.month')}</th>
                  <th>{t('pnl.revenue')}</th>
                  <th>{t('pnl.expenses')}</th>
                  <th>{t('pnl.net')}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_month.map((m) => (
                  <tr key={m.month}>
                    <th>{m.month}</th>
                    <td>{money(m.revenue)}</td>
                    <td>{money(m.expenses)}</td>
                    <td className={m.net < 0 ? 'is-negative' : ''}>{money(m.net)}</td>
                  </tr>
                ))}
                <tr className="is-total">
                  <th>{t('pnl.total')}</th>
                  <td>{money(data.revenue)}</td>
                  <td>{money(data.expenses)}</td>
                  <td>{money(data.net_income)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!compact && (
        <section className="dash-section">
          <h3 className="dash-panel-title">{t('pnl.byAccount')}</h3>
          <div className="statement-wrap">
            <table className="statement">
              <tbody>
                <tr className="is-group">
                  <th colSpan={2}>{t('pnl.revenue')}</th>
                </tr>
                {revenue.map((a) => (
                  <tr key={`r-${a.account}`}>
                    <th>{a.account}</th>
                    <td>{money(a.amount)}</td>
                  </tr>
                ))}
                <tr className="is-group">
                  <th colSpan={2}>{t('pnl.expenses')}</th>
                </tr>
                {expenses.map((a) => (
                  <tr key={`e-${a.account}`}>
                    <th>{a.account}</th>
                    <td>{money(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.needs_review.length > 0 && (
        <section className="dash-section" data-testid="needs-review">
          <h3 className="dash-panel-title with-icon is-warn">
            <ICON.warn />
            {t('pnl.needsReview', { n: data.needs_review.length })}
          </h3>
          <ul className="ledger">
            {data.needs_review.map((r) => (
              <li key={r.row} className="ledger-row is-review">
                <span className="ledger-main">
                  <strong>{t('pnl.row', { n: r.row })}</strong>
                  <span className="ledger-meta">{r.reason}</span>
                </span>
                <code className="ledger-amount">{r.value}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
