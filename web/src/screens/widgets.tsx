import { useLinks } from '../scope';
// The widget set (I30 · W8): compact, data-wired pieces of the fixed screens. The dashboard's
// default (2026-11-07): stats · todo · office · artifact-latest · schedule · budget (the cost area).
// Titles never carry a count ("my approvals 0"): a count is a chip when there is something, an
// empty sentence when there is not.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAgents, useApprovals, useArtifacts, useBudget, useOrgChart, useSchedules, useWorkflows, useWork } from '../api/queries';
import type { Artifact, BriefData, PnlData, WidgetSpec } from '../api/types.gen';
import { PnlSummary } from '../components/PnlView';
import { AgentIcon } from '../characters/PenguinIcon';
import { ApprovalCard } from '../components/ApprovalCard';
import { ArtifactBody } from '../components/ArtifactBody';
import { CostSection } from '../components/Cost';
import { Loading, Placeholder, QueryError } from '../components/Status';
import { kindLabel, useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName, useAgentName } from '../lib/agentNames';
import { cronText } from '../lib/cron';
import { teamName } from '../lib/names';
import { taskCounts } from '../lib/tasks';
import { scheduleTitle } from '../views/ScheduleView';
import { RUN_STATUS } from '../views/WorkflowsView';

function Frame({ title, to, more, count, children }: { title: string; to?: string; more?: string; count?: number; children: ReactNode }) {
  return (
    <section className="panel widget">
      <header className="widget-head">
        <h2 className="panel-title with-count">
          {title}
          {!!count && <span className="chip is-warn">{count}</span>}
        </h2>
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

/** The number row: in progress · waiting approvals · done today · this month's cost. One strip,
 * not four boxes; each number opens where it is counted. */
export function StatsWidget() {
  const { w: toWs } = useLinks();
  const { t, fmt } = useI18n();
  const approvals = useApprovals();
  const work = useWork({ limit: 150 });
  const budget = useBudget();
  const c = taskCounts(approvals.data ?? [], work.data?.items ?? [], new Date());
  const ready = !approvals.isPending && !work.isPending;
  const org = budget.data?.org;
  const capPct = org?.budget_usd ? Math.round((org.spent_usd / org.budget_usd) * 100) : null;
  const cells = [
    { key: 'running', label: t('stats.running'), value: ready ? fmt.number(c.running) : '–', note: null, to: toWs('/tasks#running'), live: c.running > 0 },
    {
      key: 'waiting',
      label: t('stats.waiting'),
      value: ready ? fmt.number(c.waiting) : '–',
      note: c.mine > 0 ? t('stats.mine', { n: c.mine }) : null,
      to: toWs('/tasks#todo'),
      live: false,
    },
    { key: 'done', label: t('stats.doneToday'), value: ready ? fmt.number(c.doneToday) : '–', note: null, to: toWs('/tasks#done'), live: false },
    {
      key: 'cost',
      label: t('stats.cost'),
      value: org ? fmt.usd(org.spent_usd) : '–',
      note: capPct !== null ? t('stats.capPct', { pct: capPct }) : org ? t('budget.noCap') : null,
      to: toWs('/dashboard#cost'),
      live: false,
    },
  ];
  return (
    <section className="panel dash-stats" aria-label={t('stats.label')} data-testid="stats">
      {cells.map((cell) => (
        <Link key={cell.key} className={`dash-stat ${cell.key === 'waiting' && c.mine > 0 ? 'is-attention' : ''}`} to={cell.to} data-testid={`stat-${cell.key}`}>
          <span className="dash-stat-label">
            {cell.live && <span className="live-dot" aria-hidden />}
            {cell.label}
          </span>
          <span className="dash-stat-value">{cell.value}</span>
          {cell.note && <span className="dash-stat-note">{cell.note}</span>}
        </Link>
      ))}
    </section>
  );
}

/** What waits for this person — a short list, each row opening Task where it can be answered. */
export function TodoWidget() {
  const { w: toWs } = useLinks();
  const { t, fmt, locale } = useI18n();
  const nameOf = useAgentName();
  const approvals = useApprovals();
  const reviews = useArtifacts({ needs_review: true, limit: 20 });
  const mine = (approvals.data ?? []).filter((a) => a.can_approve);
  const checks = reviews.data ?? [];
  const total = mine.length + checks.length;
  const rows = [
    ...mine.map((a) => ({
      key: `a-${a.run_id}`,
      icon: <ICON.person className="run-row-icon" />,
      title: a.card.title,
      meta: a.source === 'workflow' ? t('approvals.fromWorkflow', { name: a.card.workflow ?? '' }) : t('approvals.fromAgent', { name: nameOf(a.card.agent) }),
      chip: t('widget.todoApprove'),
      when: a.created,
      to: toWs('/tasks#todo'),
    })),
    ...checks.map((r) => ({
      key: `r-${r.id}`,
      icon: <ICON.artifacts className="run-row-icon" />,
      title: r.title,
      meta: kindLabel(locale, r.kind),
      chip: t('artifact.needsReviewShort'),
      when: r.created,
      to: toWs(`/tasks/artifacts/${r.id}`),
    })),
  ].sort((x, y) => y.when - x.when);

  return (
    <Frame title={t('widget.todo')} count={total} to={toWs('/tasks')} more={t('widget.todoMore')}>
      {approvals.isPending ? <Loading /> : approvals.error ? <QueryError error={approvals.error} /> : total === 0 ? (
        <p className="dash-hint">{t('widget.todoNone')}</p>
      ) : (
        <ul className="run-list">
          {rows.slice(0, 4).map((r) => (
            <li key={r.key}>
              <Link className="run-row todo-row" to={r.to}>
                {r.icon}
                <span className="todo-text">
                  <span className="run-row-title">{r.title}</span>
                  <span className="dash-hint">
                    {r.meta} · {fmt.relative(r.when)}
                  </span>
                </span>
                <span className="chip is-warn">{r.chip}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 4 && <p className="dash-hint">{t('widget.todoRest', { n: rows.length - 4 })}</p>}
    </Frame>
  );
}

export function ApprovalsWidget() {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const q = useApprovals();
  const mine = (q.data ?? []).filter((a) => a.can_approve);
  return (
    <Frame title={t('widget.approvals')} count={mine.length} to={toWs('/tasks')} more={t('widget.all')}>
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
    <Frame title={a?.title ?? t('widget.latest', { kind: kindLabel(locale, kind) })} to={a ? toWs(`/tasks/artifacts/${a.id}`) : undefined} more={t('widget.open')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : !a ? (
        <p className="dash-hint">{t('widget.noArtifact')}</p>
      ) : (
        <ArtifactSummary artifact={a} when={fmt.dateTime(a.created)} />
      )}
    </Frame>
  );
}

/** A work product in two lines — its date and what to check, then its gist. The whole of it
 * (the P&L table, the brief) is on its detail screen in Task. */
function ArtifactSummary({ artifact: a, when }: { artifact: Artifact; when: string }) {
  const { t } = useI18n();
  const pnl = a.kind === 'finance.pnl' ? (a.data as unknown as PnlData) : null;
  const toCheck = pnl ? pnl.needs_review.length : 0;
  return (
    <div className="artifact-summary" data-testid="artifact-summary">
      <p className="dash-hint widget-meta">
        {when}
        {toCheck > 0 ? (
          <span className="chip is-warn">{t('pnl.needsReview', { n: toCheck })}</span>
        ) : (
          a.needs_review && <span className="chip is-warn">{t('artifact.needsReviewShort')}</span>
        )}
      </p>
      {pnl ? (
        <PnlSummary data={pnl} />
      ) : a.kind === 'brief' ? (
        <p className="brief-text is-clamped">{(a.data as unknown as BriefData).text}</p>
      ) : (
        <ArtifactBody artifact={a} />
      )}
    </div>
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
              <Link className="run-row" to={toWs(`/tasks/artifacts/${a.id}`)}>
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

/** The whole cost area (the old cost screen) — the dashboard always has it. */
export function BudgetWidget() {
  return <CostSection />;
}

/** Who is at work — penguins with what each is on; an idle office says so in one line. */
export function OfficeWidget() {
  const { w: toWs } = useLinks();
  const { t, locale } = useI18n();
  const q = useAgents();
  const working = (q.data ?? []).filter((a) => a.working_on.length > 0);
  return (
    <Frame title={t('widget.office')} to={toWs('/office')} more={t('widget.enter')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : working.length === 0 ? (
        <p className="dash-hint">{t('widget.allIdle')}</p>
      ) : (
        <ul className="office-mini" aria-live="polite">
          {working.map((a) => (
            <li key={a.name} className="office-mini-row">
              <AgentIcon agent={a.name} team={a.team} size={28} label="" />
              <span className="office-mini-text">
                <strong>{agentName(a.name, locale, a)}</strong>
                <span className="dash-hint">{a.working_on.map((w) => w.title).join(', ')}</span>
              </span>
              <span className="chip is-accent">{t('office.status.typing')}</span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/** The next scheduled runs — when, what, how often. */
export function ScheduleWidget() {
  const { w: toWs } = useLinks();
  const { t, fmt, locale } = useI18n();
  const q = useSchedules();
  const next = (q.data?.schedules ?? []).filter((s) => s.next_run != null).slice(0, 4);
  return (
    <Frame title={t('widget.schedule')} to={toWs('/schedule')} more={t('widget.all')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : next.length === 0 ? (
        <p className="dash-hint">{t('schedule.none')}</p>
      ) : (
        <ol className="next-runs">
          {next.map((s) => (
            <li key={s.id} className="next-run">
              <time className="next-run-when" dateTime={new Date((s.next_run ?? 0) * 1000).toISOString()} title={fmt.dateTime(s.next_run ?? 0)}>
                {fmt.relative(s.next_run ?? 0)}
              </time>
              <span className="next-run-what">
                <strong>{scheduleTitle(s)}</strong>
                <span className="dash-hint">{cronText(s.schedule, locale, t)}</span>
              </span>
            </li>
          ))}
        </ol>
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
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const q = useOrgChart();
  return (
    <Frame title={t('nav.org')} to={toWs('/office')} more={t('widget.open')}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : (
        <ul className="run-list">
          {q.data.teams.map((tm) => (
            <li key={tm.name}>
              <span className="run-row">
                <strong className="run-row-title">{teamName(tm.name, t)}</strong>
                <span className="dash-hint">{t('widget.teamCounts', { agents: tm.agents.length, people: tm.people.length })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
