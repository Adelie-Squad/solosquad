// The account dashboard (decision 60 · DESIGN.md `### 대시보드`): the whole company on one screen,
// filtered by business (org) and workspace. It adds up the workspace APIs the person may open —
// every request still goes through the scope gate, so a team member's numbers are only their
// scopes' — and the account calendar. Each row says where it comes from and opens there.
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { scopedKeys, useCalendar, useCalendarLabels } from '../api/queries';
import type { Agent, ApprovalItem, Artifact, Budget, CalendarItem, ScheduleList, ScopeOrg, WorkList } from '../api/types.gen';
import { AgentIcon } from '../characters/PenguinIcon';
import { BudgetBar } from '../components/Cost';
import { Loading } from '../components/Status';
import { kindLabel, useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName, useAgentName } from '../lib/agentNames';
import { addDays, colorOf, dayText, iso, timeOf } from '../lib/calendar';
import { cronText } from '../lib/cron';
import { shownName } from '../lib/names';
import { taskCounts } from '../lib/tasks';
import { apiPath, routes } from '../scope';
import { useSession } from '../session';
import { scheduleTitle } from './ScheduleView';

export interface WsRef {
  org: string;
  ws: string;
  orgDisplay: string;
  wsDisplay: string;
  running: boolean;
}

/** The workspaces a filter covers, from /api/me — only what the person is assigned. */
export function scopesIn(scopes: ScopeOrg[], org: string | null, ws: string | null): WsRef[] {
  return scopes
    .filter((o) => !org || o.org === org)
    .flatMap((o) =>
      o.workspaces
        .filter((w) => !ws || w.name === ws)
        .map((w) => ({ org: o.org, ws: w.name, orgDisplay: shownName(o.org, o.display), wsDisplay: shownName(w.name, w.display), running: w.running })),
    );
}

function useAll<T>(refs: WsRef[], key: (k: ReturnType<typeof scopedKeys>) => readonly unknown[], path: string, query?: Record<string, string | number | boolean>) {
  return useQueries({
    queries: refs.map((r) => ({
      queryKey: query ? [...key(scopedKeys(r)), query] : key(scopedKeys(r)),
      queryFn: () => api.get<T>(apiPath.ws(r, path), query),
      enabled: r.running,
    })),
  });
}

function Panel({ title, count, to, more, children, wide, testid }: { title: string; count?: number; to?: string; more?: string; children: ReactNode; wide?: boolean; testid?: string }) {
  return (
    <section className={`panel widget ${wide ? 'is-wide' : ''}`} data-testid={testid}>
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

const From = ({ r }: { r: WsRef }) => <span className="from-scope">{`${r.orgDisplay} · ${r.wsDisplay}`}</span>;

export function AccountDashboard() {
  const { t, fmt, locale } = useI18n();
  const { me, user } = useSession();
  const nameOf = useAgentName();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const org = params.get('org');
  const ws = params.get('ws');
  const orgScope = org ? me.scopes.find((o) => o.org === org) : undefined;
  const unknown = (!!org && !orgScope) || (!!ws && !orgScope?.workspaces.some((w) => w.name === ws));
  const refs = useMemo(() => (unknown ? [] : scopesIn(me.scopes, org, ws)), [me.scopes, org, ws, unknown]);
  const running = refs.filter((r) => r.running);
  const stopped = refs.filter((r) => !r.running);

  const approvals = useAll<ApprovalItem[]>(refs, (k) => k.approvals, '/approvals');
  const reviews = useAll<Artifact[]>(refs, (k) => k.artifacts, '/artifacts', { needs_review: true, limit: 20 });
  const work = useAll<WorkList>(refs, (k) => k.work, '/work', { limit: 150 });
  const agents = useAll<Agent[]>(refs, (k) => k.agents, '/agents');
  const schedules = useAll<ScheduleList>(refs, (k) => k.schedules, '/schedules');
  const budgets = useAll<Budget>(refs, (k) => k.budget, '/budget');

  const today = iso(new Date());
  const cal = useCalendar({ from: today, to: addDays(today, 14), org: org ?? undefined, workspace: ws ?? undefined, done: false }, !unknown);
  const labels = useCalendarLabels();

  const costRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (location.hash === '#cost') costRef.current?.scrollIntoView?.({ block: 'start' });
  }, [location.hash]);

  const setFilter = (o: string | null, w: string | null) => {
    const next = new URLSearchParams(params);
    if (o) next.set('org', o);
    else next.delete('org');
    if (w) next.set('ws', w);
    else next.delete('ws');
    setParams(next, { replace: true });
  };

  const zipped = <T,>(qs: { data?: T }[]) => refs.map((r, i) => ({ r, data: qs[i]?.data }));
  const now = new Date();
  const counts = refs.reduce(
    (acc, _r, i) => {
      const c = taskCounts(approvals[i]?.data ?? [], work[i]?.data?.items ?? [], now);
      return { running: acc.running + c.running, waiting: acc.waiting + c.waiting, mine: acc.mine + c.mine, doneToday: acc.doneToday + c.doneToday };
    },
    { running: 0, waiting: 0, mine: 0, doneToday: 0 },
  );
  const spent = budgets.reduce((s, q) => s + (q.data?.org?.spent_usd ?? 0), 0);
  const ready = approvals.every((q, i) => !refs[i]?.running || !q.isPending);
  const firstRef = running[0];

  // my to-dos: cards I may answer + work products to check + today's calendar to-dos for me
  const itemById = new Map<string, CalendarItem>([...(cal.data?.items ?? []), ...(cal.data?.context ?? [])].map((i) => [i.id, i]));
  const myToday = (cal.data?.todos ?? []).filter((td) => !td.done && td.due?.slice(0, 10) === today && (!td.assignee_id || td.assignee_id === user?.id));
  const todoRows = [
    ...zipped(approvals).flatMap(({ r, data }) =>
      (data ?? [])
        .filter((a) => a.can_approve)
        .map((a) => ({
          key: `a-${r.org}-${r.ws}-${a.run_id}`,
          icon: <ICON.person className="run-row-icon" />,
          title: a.card.title,
          meta: a.source === 'workflow' ? t('approvals.fromWorkflow', { name: a.card.workflow ?? '' }) : t('approvals.fromAgent', { name: nameOf(a.card.agent) }),
          chip: t('widget.todoApprove'),
          r,
          when: a.created,
          to: routes.ws(r.org, r.ws, '/tasks#todo'),
        })),
    ),
    ...zipped(reviews).flatMap(({ r, data }) =>
      (data ?? []).map((a) => ({
        key: `r-${r.org}-${r.ws}-${a.id}`,
        icon: <ICON.artifacts className="run-row-icon" />,
        title: a.title,
        meta: kindLabel(locale, a.kind),
        chip: t('artifact.needsReviewShort'),
        r,
        when: a.created,
        to: routes.ws(r.org, r.ws, `/tasks/artifacts/${a.id}`),
      })),
    ),
  ].sort((x, y) => y.when - x.when);
  const todoTotal = todoRows.length + myToday.length;

  const busy = zipped(agents).flatMap(({ r, data }) => (data ?? []).filter((a) => a.working_on.length > 0).map((a) => ({ a, r })));
  const next = zipped(schedules)
    .flatMap(({ r, data }) => (data?.schedules ?? []).filter((s) => s.next_run != null).map((s) => ({ s, r })))
    .sort((x, y) => (x.s.next_run ?? 0) - (y.s.next_run ?? 0))
    .slice(0, 4);
  const labelMap = new Map((labels.data?.labels ?? []).map((l) => [l.id, l]));
  const upcoming = (cal.data?.items ?? []).filter((i) => i.start && i.start.slice(0, 10) >= today).slice(0, 5);

  // cost — the company total and each business's
  const byOrg = new Map<string, { display: string; spent: number; cap: number | null; warning: boolean; exhausted: boolean }>();
  zipped(budgets).forEach(({ r, data }) => {
    if (!data?.org) return;
    const row = byOrg.get(r.org) ?? { display: r.orgDisplay, spent: 0, cap: 0, warning: false, exhausted: false };
    row.spent += data.org.spent_usd;
    row.cap = row.cap === null || data.org.budget_usd == null ? null : row.cap + data.org.budget_usd;
    row.warning ||= data.org.warning;
    row.exhausted ||= data.org.exhausted;
    byOrg.set(r.org, row);
  });

  const orgs = me.scopes;
  const showWs = orgScope && orgScope.workspaces.length > 1;

  return (
    <div className="view screen-dashboard account-dashboard">
      <header className="view-header">
        <div>
          <h1>{t('nav.dashboard')}</h1>
          <p>{t('dashboard.accountLead')}</p>
        </div>
        {org && ws && !unknown && (
          <Link className="btn with-icon" to={routes.ws(org, ws, '/screens/dashboard')}>
            <ICON.dashboard />
            {t('dashboard.workspaceScreen')}
          </Link>
        )}
      </header>

      {orgs.length + (showWs ? 1 : 0) > 1 && (
        <div className="filter-chips" role="group" aria-label={t('dashboard.filter')}>
          <button className={`chip-toggle ${!org ? 'is-on' : ''}`} aria-pressed={!org} onClick={() => setFilter(null, null)}>
            {t('dashboard.all')}
          </button>
          {orgs.map((o) => (
            <button key={o.org} className={`chip-toggle ${org === o.org && !ws ? 'is-on' : ''}`} aria-pressed={org === o.org && !ws} onClick={() => setFilter(o.org, null)}>
              {shownName(o.org, o.display)}
            </button>
          ))}
          {showWs &&
            orgScope.workspaces.map((w) => (
              <button key={w.name} className={`chip-toggle is-sub ${ws === w.name ? 'is-on' : ''}`} aria-pressed={ws === w.name} onClick={() => setFilter(orgScope.org, w.name)}>
                {shownName(w.name, w.display)}
              </button>
            ))}
        </div>
      )}

      {unknown ? (
        <div className="panel empty scope-notice" role="status">
          <h2>{t('scope.notFoundTitle')}</h2>
          <p>{t('scope.notFoundBody')}</p>
        </div>
      ) : (
        <>
          {stopped.length > 0 && (
            <p className="dash-hint notice-line">
              <ICON.warn className="warn-icon" />
              {t('dashboard.notStarted', { names: stopped.map((r) => `${r.orgDisplay} · ${r.wsDisplay}`).join(', ') })}
            </p>
          )}
          <div className="widget-grid">
            <div className="widget-cell is-wide">
              <section className="panel dash-stats" aria-label={t('stats.label')} data-testid="stats">
                {[
                  { key: 'running', label: t('stats.running'), value: counts.running, note: null as string | null, to: firstRef ? routes.ws(firstRef.org, firstRef.ws, '/tasks#running') : '#', live: counts.running > 0 },
                  { key: 'waiting', label: t('stats.waiting'), value: counts.waiting, note: counts.mine > 0 ? t('stats.mine', { n: counts.mine }) : null, to: firstRef ? routes.ws(firstRef.org, firstRef.ws, '/tasks#todo') : '#', live: false },
                  { key: 'done', label: t('stats.doneToday'), value: counts.doneToday, note: null, to: firstRef ? routes.ws(firstRef.org, firstRef.ws, '/tasks#done') : '#', live: false },
                ].map((cell) => (
                  <Link key={cell.key} className={`dash-stat ${cell.key === 'waiting' && counts.mine > 0 ? 'is-attention' : ''}`} to={cell.to} data-testid={`stat-${cell.key}`}>
                    <span className="dash-stat-label">
                      {cell.live && <span className="live-dot" aria-hidden />}
                      {cell.label}
                    </span>
                    <span className="dash-stat-value">{ready ? fmt.number(cell.value) : '–'}</span>
                    {cell.note && <span className="dash-stat-note">{cell.note}</span>}
                  </Link>
                ))}
                <a className="dash-stat" href="#cost" data-testid="stat-cost">
                  <span className="dash-stat-label">{t('stats.cost')}</span>
                  <span className="dash-stat-value">{fmt.usd(spent)}</span>
                </a>
              </section>
            </div>

            <div className="widget-cell">
              <Panel title={t('widget.todo')} count={todoTotal} testid="account-todo">
                {!ready ? (
                  <Loading />
                ) : todoTotal === 0 ? (
                  <p className="dash-hint">{t('widget.todoNone')}</p>
                ) : (
                  <ul className="run-list">
                    {myToday.slice(0, 3).map((td) => {
                      const it = itemById.get(td.item_id);
                      return (
                        <li key={`c-${td.id}`}>
                          <Link className="run-row todo-row" to={`/calendar?view=list&date=${today}&item=${td.item_id}`}>
                            <ICON.todo className="run-row-icon" />
                            <span className="todo-text">
                              <span className="run-row-title">{td.title}</span>
                              <span className="dash-hint">{it?.title ?? ''}</span>
                            </span>
                            <span className="chip is-accent">{t('dashboard.todoToday')}</span>
                          </Link>
                        </li>
                      );
                    })}
                    {todoRows.slice(0, Math.max(0, 4 - Math.min(3, myToday.length))).map((r) => (
                      <li key={r.key}>
                        <Link className="run-row todo-row" to={r.to}>
                          {r.icon}
                          <span className="todo-text">
                            <span className="run-row-title">{r.title}</span>
                            <span className="dash-hint">
                              {r.meta} · <From r={r.r} /> · {fmt.relative(r.when)}
                            </span>
                          </span>
                          <span className="chip is-warn">{r.chip}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="widget-cell">
              <Panel title={t('widget.office')}>
                {busy.length === 0 ? (
                  <p className="dash-hint">{t('widget.allIdle')}</p>
                ) : (
                  <ul className="office-mini" aria-live="polite">
                    {busy.slice(0, 5).map(({ a, r }) => (
                      <li key={`${r.org}-${r.ws}-${a.name}`} className="office-mini-row">
                        <AgentIcon agent={a.name} team={a.team} size={28} label="" />
                        <span className="office-mini-text">
                          <strong>{agentName(a.name, locale, a)}</strong>
                          <span className="dash-hint">
                            {a.working_on.map((w) => w.title).join(', ')} · <From r={r} />
                          </span>
                        </span>
                        <Link className="chip is-accent" to={routes.ws(r.org, r.ws, '/office')}>
                          {t('office.status.typing')}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="widget-cell">
              <Panel title={t('dashboard.upcoming')} to="/calendar" more={t('dashboard.openCalendar')} testid="account-upcoming">
                {cal.isPending ? (
                  <Loading />
                ) : upcoming.length === 0 ? (
                  <p className="dash-hint">{t('dashboard.upcomingNone')}</p>
                ) : (
                  <ol className="next-runs">
                    {upcoming.map((i) => (
                      <li key={i.id} className="next-run">
                        <time className="next-run-when" dateTime={i.start ?? ''}>
                          {dayText(i.start ?? today, locale)}
                          {timeOf(i.start) ? ` ${timeOf(i.start)}` : ''}
                        </time>
                        <span className="next-run-what">
                          <Link className={`cal-chip-line ${i.kind === 'personal' ? 'is-personal' : ''}`} data-color={colorOf(i, labelMap, itemById)} to={`/calendar?view=list&date=${i.start?.slice(0, 10)}&item=${i.id}`}>
                            <strong>{i.title}</strong>
                          </Link>
                          <span className="dash-hint">{i.kind === 'personal' ? t('calendar.personalCrumb') : shownName(i.org ?? '', me.scopes.find((o) => o.org === i.org)?.display)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>

            <div className="widget-cell">
              <Panel title={t('dashboard.nextRuns')}>
                {next.length === 0 ? (
                  <p className="dash-hint">{t('schedule.none')}</p>
                ) : (
                  <ol className="next-runs">
                    {next.map(({ s, r }) => (
                      <li key={`${r.org}-${r.ws}-${s.id}`} className="next-run">
                        <time className="next-run-when" dateTime={new Date((s.next_run ?? 0) * 1000).toISOString()} title={fmt.dateTime(s.next_run ?? 0)}>
                          {fmt.relative(s.next_run ?? 0)}
                        </time>
                        <span className="next-run-what">
                          <strong>{scheduleTitle(s)}</strong>
                          <span className="dash-hint">
                            {cronText(s.schedule, locale, t)} · <From r={r} />
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>

            <div className="widget-cell is-wide" id="cost" ref={costRef}>
              <section className="panel cost-section" data-testid="account-cost">
                <header className="widget-head">
                  <h2 className="panel-title">{t('budget.title')}</h2>
                </header>
                <BudgetBar label={t('dashboard.costTotal')} line={{ spent_usd: spent, budget_usd: null, remaining_usd: null, warning: false, exhausted: false }} />
                {byOrg.size > 0 && <h3 className="cost-sub">{t('dashboard.costByOrg')}</h3>}
                {[...byOrg.entries()].map(([id, row]) => (
                  <BudgetBar key={id} label={row.display} line={{ spent_usd: row.spent, budget_usd: row.cap || null, remaining_usd: row.cap ? row.cap - row.spent : null, warning: row.warning, exhausted: row.exhausted }} />
                ))}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


