import { useLinks } from '../scope';
// The first widget set (I30 · W8): compact, data-wired versions of the fixed screens.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAgents, useApprovals, useArtifacts, useBudget, useOrgChart, useWorkflows } from '../api/queries';
import type { WidgetSpec } from '../api/types.gen';
import { ApprovalCard } from '../components/ApprovalCard';
import { ArtifactBody } from '../components/ArtifactBody';
import { Loading, Placeholder, QueryError } from '../components/Status';
import { kindLabel, useI18n } from '../i18n';
import { ICON } from '../icons';
import { readable } from '../lib/names';
import { BudgetBar } from '../views/BudgetView';
import { RUN_STATUS } from '../views/WorkflowsView';

function Frame({ title, to, more, children }: { title: string; to?: string; more?: string; children: ReactNode }) {
  return (
    <section className="panel widget">
      <header className="widget-head">
        <h2 className="panel-title">{title}</h2>
        {to && more && (
          <Link className="widget-more" to={to}>
            {more}
            <ICON.more size={14} />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

const prop = (spec: WidgetSpec, key: string): string | undefined => {
  const v = spec[key];
  return typeof v === 'string' && v ? v : undefined;
};

export function ApprovalsWidget() {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const q = useApprovals();
  const mine = (q.data ?? []).filter((a) => a.can_approve);
  return (
    <Frame title={t('widget.approvals', { n: mine.length })} to={toWs('/approvals')} more={t('widget.all')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : mine.length === 0 ? (
        <p className="dash-hint">{t('approvals.none')}</p>
      ) : (
        <div className="stack">
          {mine.slice(0, 3).map((a) => (
            <ApprovalCard key={`${a.source}-${a.run_id}`} item={a} compact />
          ))}
        </div>
      )}
    </Frame>
  );
}

export function ArtifactLatestWidget({ spec }: { spec: WidgetSpec }) {
  const { w: toWs } = useLinks();
  const { t, fmt, locale } = useI18n();
  const kind = prop(spec, 'kind');
  const q = useArtifacts({ kind, limit: 1 });
  if (!kind) return <Placeholder title={t('screen.missingProp', { widget: spec.widget, prop: 'kind' })} />;
  const a = q.data?.[0];
  return (
    <Frame title={a?.title ?? t('widget.latest', { kind: kindLabel(locale, kind) })} to={a ? toWs(`/artifacts/${a.id}`) : undefined} more={t('widget.open')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : !a ? (
        <p className="dash-hint">{t('widget.noArtifact')}</p>
      ) : (
        <>
          <p className="dash-hint widget-meta">
            {fmt.dateTime(a.created)}
            {a.needs_review && <span className="chip is-warn">{t('artifact.needsReviewShort')}</span>}
          </p>
          <ArtifactBody artifact={a} compact />
        </>
      )}
    </Frame>
  );
}

export function ArtifactListWidget({ spec }: { spec: WidgetSpec }) {
  const { w: toWs } = useLinks();
  const { t, fmt, locale } = useI18n();
  const q = useArtifacts({ kind: prop(spec, 'kind'), limit: 20 });
  return (
    <Frame title={t('widget.artifacts')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : (q.data ?? []).length === 0 ? (
        <p className="dash-hint">{t('widget.noArtifact')}</p>
      ) : (
        <ul className="run-list">
          {(q.data ?? []).map((a) => (
            <li key={a.id}>
              <Link className="run-row" to={toWs(`/artifacts/${a.id}`)}>
                <ICON.artifacts className="run-row-icon" />
                <span className="run-row-title">{a.title}</span>
                <span className="chip">{kindLabel(locale, a.kind)}</span>
                {a.needs_review && <span className="chip is-warn">{t('artifact.needsReviewShort')}</span>}
                <span className="dash-hint">{fmt.relative(a.created)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

export function BudgetWidget() {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const q = useBudget();
  return (
    <Frame title={t('budget.title')} to={toWs('/budget')} more={t('widget.details')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : <BudgetBar label={t('budget.org')} line={q.data.org} />}
    </Frame>
  );
}

export function OfficeWidget() {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const q = useAgents();
  const working = (q.data ?? []).filter((a) => a.working_on.length > 0);
  return (
    <Frame title={t('widget.office', { n: working.length })} to={toWs('/office')} more={t('widget.enter')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : working.length === 0 ? (
        <p className="dash-hint">{t('widget.allIdle')}</p>
      ) : (
        <ul className="run-list">
          {working.map((a) => (
            <li key={a.name}>
              <span className="run-row">
                <span className="live-dot" />
                <strong className="run-row-title">{a.name}</strong>
                <span className="dash-hint">{a.working_on.map((w) => w.title).join(', ')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

export function WorkflowsWidget() {
  const { w: toWs } = useLinks();
  const { t, fmt } = useI18n();
  const q = useWorkflows();
  return (
    <Frame title={t('nav.workflows')} to={toWs('/workflows')} more={t('widget.all')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : q.data.workflows.length === 0 ? (
        <p className="dash-hint">{t('workflows.none')}</p>
      ) : (
        <ul className="run-list">
          {q.data.workflows.map((w) => (
            <li key={w.name}>
              <Link className="run-row" to={toWs(`/workflows/${w.name}`)}>
                <ICON.workflows className="run-row-icon" />
                <span className="run-row-title">{w.title}</span>
                {w.last_run ? (
                  <>
                    <span className={`chip ${RUN_STATUS[w.last_run.status].chip}`}>{t(RUN_STATUS[w.last_run.status].label)}</span>
                    <span className="dash-hint">{fmt.relative(w.last_run.created)}</span>
                  </>
                ) : (
                  <span className="dash-hint">{t('workflows.noRuns')}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

export function OrgChartWidget() {
  const { o: toOrg } = useLinks();
  const { t } = useI18n();
  const q = useOrgChart();
  return (
    <Frame title={t('nav.org')} to={toOrg('/org')} more={t('widget.open')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : (
        <ul className="run-list">
          {q.data.teams.map((tm) => (
            <li key={tm.name}>
              <span className="run-row">
                <strong className="run-row-title">{readable(tm.name)}</strong>
                <span className="dash-hint">{t('widget.teamCounts', { agents: tm.agents.length, people: tm.people.length })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
