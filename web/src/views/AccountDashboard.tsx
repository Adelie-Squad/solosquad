// The account dashboard (decision 60 · DESIGN.md `### 대시보드`, 2026-11-10): first what happened
// while the person was away and what waits for their confirmation (자리를 비운 동안, the engine's
// digest), then the work tabs — 진행 예정 · 진행 중 · 승인 대기 · 오늘 완료, each opening its list —
// then this month's cost. The tabs add up the workspace APIs the person may open, filtered by
// business and workspace; every request still goes through the scope gate, so a team member's
// numbers are only their scopes'.
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { scopedKeys, useCalendar, useCalendarLabels } from '../api/queries';
import type { ApprovalItem, Artifact, Budget, CalendarItem, ScheduleList, ScopeOrg, WorkList } from '../api/types.gen';
import { BudgetBar } from '../components/Cost';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { addDays, colorOf, dayText, iso, timeOf } from '../lib/calendar';
import { cronText } from '../lib/cron';
import { shownName } from '../lib/names';
import { endedAt, startOfDay } from '../lib/tasks';
import { apiPath, routes } from '../scope';
import { useSession } from '../session';
import { AwayDigest } from './dashboard/AwayDigest';
import { defaultTab, TABS, WorkTabs, type Lists, type TabKey, type Upcoming } from './dashboard/WorkTabs';
import { From, type WsRef } from './dashboard/WsScope';
import { scheduleTitle } from './ScheduleView';

export type { WsRef } from './dashboard/WsScope';

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

const UPCOMING_DAYS = 14;
const isTab = (v: string | null): v is TabKey => !!v && (TABS as string[]).includes(v);

/** A calendar day or local date-time as epoch seconds, for sorting with the scheduled runs. */
const at = (when: string) => new Date(when.includes('T') ? when : `${when}T00:00`).getTime() / 1000;

export function AccountDashboard() {
  const { t, fmt, locale } = useI18n();
  const { me, user } = useSession();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const org = params.get('org');
  const ws = params.get('ws');
  const picked = params.get('tab');
  const orgScope = org ? me.scopes.find((o) => o.org === org) : undefined;
  const unknown = (!!org && !orgScope) || (!!ws && !orgScope?.workspaces.some((w) => w.name === ws));
  const refs = useMemo(() => (unknown ? [] : scopesIn(me.scopes, org, ws)), [me.scopes, org, ws, unknown]);
  const stopped = refs.filter((r) => !r.running);

  const approvals = useAll<ApprovalItem[]>(refs, (k) => k.approvals, '/approvals');
  const reviews = useAll<Artifact[]>(refs, (k) => k.artifacts, '/artifacts', { needs_review: true, limit: 20 });
  const work = useAll<WorkList>(refs, (k) => k.work, '/work', { limit: 150 });
  const schedules = useAll<ScheduleList>(refs, (k) => k.schedules, '/schedules');
  const budgets = useAll<Budget>(refs, (k) => k.budget, '/budget');

  const today = iso(new Date());
  const cal = useCalendar({ from: today, to: addDays(today, UPCOMING_DAYS), org: org ?? undefined, workspace: ws ?? undefined, done: false }, !unknown);
  const labels = useCalendarLabels();

  const costRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (location.hash === '#cost') costRef.current?.scrollIntoView?.({ block: 'start' });
  }, [location.hash]);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const setFilter = (o: string | null, w: string | null) => setParam({ org: o, ws: w });

  const zipped = <T,>(qs: { data?: T }[]) => refs.map((r, i) => ({ r, data: qs[i]?.data }));
  const ready = [approvals, reviews, work].every((qs) => qs.every((q, i) => !refs[i]?.running || !q.isPending));
  const now = new Date();
  const dayStart = startOfDay(now);
  const nowS = now.getTime() / 1000;

  // ── the four lists (the numbers are their lengths) ──────────────────────────────────
  const itemById = new Map<string, CalendarItem>([...(cal.data?.items ?? []), ...(cal.data?.context ?? [])].map((i) => [i.id, i]));
  const labelMap = new Map((labels.data?.labels ?? []).map((l) => [l.id, l]));
  const orgName = (o: string | null) => shownName(o ?? '', me.scopes.find((s) => s.org === o)?.display);
  const horizon = nowS + UPCOMING_DAYS * 86400;
  const upcoming: Upcoming[] = [
    ...zipped(schedules).flatMap(({ r, data }) =>
      (data?.schedules ?? [])
        .filter((s) => s.next_run != null && s.next_run <= horizon)
        .map((s) => ({
          key: `s-${r.org}-${r.ws}-${s.id}`,
          at: s.next_run ?? 0,
          when: fmt.relative(s.next_run ?? 0),
          whenTitle: fmt.dateTime(s.next_run ?? 0),
          title: scheduleTitle(s),
          kind: t('schedule.tab'),
          meta: (
            <>
              {cronText(s.schedule, locale, t)} · <From r={r} />
            </>
          ),
          to: routes.ws(r.org, r.ws, '/scheduled-jobs'),
        })),
    ),
    ...(cal.data?.items ?? [])
      .filter((i) => i.start && i.start.slice(0, 10) >= today)
      .map((i) => ({
        key: `i-${i.id}`,
        at: at(i.start ?? today),
        when: `${dayText(i.start ?? today, locale)}${timeOf(i.start) ? ` ${timeOf(i.start)}` : ''}`,
        title: i.title,
        kind: t('nav.calendar'),
        meta: i.kind === 'personal' ? t('calendar.personalCrumb') : orgName(i.org),
        to: `/calendar?view=list&date=${i.start?.slice(0, 10)}&item=${i.id}`,
        color: colorOf(i, labelMap, itemById),
        personal: i.kind === 'personal',
      })),
    ...(cal.data?.todos ?? [])
      .filter((td) => !td.done && td.due && td.due.slice(0, 10) >= today && (!td.assignee_id || td.assignee_id === user?.id))
      .map((td) => {
        const it = itemById.get(td.item_id);
        return {
          key: `t-${td.id}`,
          at: at(td.due ?? today),
          when: `${dayText(td.due ?? today, locale)}${timeOf(td.due) ? ` ${timeOf(td.due)}` : ''}`,
          title: td.title,
          kind: t('calendar.todo'),
          meta: it?.title ?? '',
          to: `/calendar?view=list&date=${td.due?.slice(0, 10)}&item=${td.item_id}`,
        };
      }),
  ].sort((x, y) => x.at - y.at);

  const lists: Lists = {
    upcoming,
    running: zipped(work).flatMap(({ r, data }) => (data?.items ?? []).filter((w) => w.status === 'running' || w.status === 'pending').map((w) => ({ r, w }))),
    mine: zipped(approvals).flatMap(({ r, data }) => (data ?? []).filter((a) => a.can_approve).map((a) => ({ r, a }))),
    reviews: zipped(reviews).flatMap(({ r, data }) => (data ?? []).filter((a) => a.needs_review).map((a) => ({ r, a }))),
    others: zipped(approvals).flatMap(({ r, data }) => (data ?? []).filter((a) => !a.can_approve).map((a) => ({ r, a }))),
    done: zipped(work)
      .flatMap(({ r, data }) => (data?.items ?? []).filter((w) => w.status === 'success' && endedAt(w) >= dayStart).map((w) => ({ r, w })))
      .sort((x, y) => endedAt(y.w) - endedAt(x.w)),
  };
  lists.mine.sort((x, y) => y.a.created - x.a.created);
  const selected: TabKey = isTab(picked) ? picked : defaultTab(lists);

  // ── cost: the company total this month, then each business ──────────────────────────
  const spent = budgets.reduce((s, q) => s + (q.data?.org?.spent_usd ?? 0), 0);
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

      {/* the whole account, whatever the chips below show: 확인했어요 confirms all of it */}
      <AwayDigest
        onShowWaiting={() => {
          setParam({ tab: 'waiting', org: null, ws: null });
          document.getElementById('dash-tab-panel')?.scrollIntoView?.({ block: 'start' });
        }}
      />

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
              <WorkTabs lists={lists} selected={selected} onSelect={(k) => setParam({ tab: k })} ready={ready} />
            </div>

            <div className="widget-cell is-wide" id="cost" ref={costRef}>
              <section className="panel cost-section" data-testid="account-cost">
                <header className="widget-head">
                  <h2 className="panel-title">{t('budget.title')}</h2>
                </header>
                <BudgetBar label={t('dashboard.costMonthTotal')} line={{ spent_usd: spent, budget_usd: null, remaining_usd: null, warning: false, exhausted: false }} />
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
