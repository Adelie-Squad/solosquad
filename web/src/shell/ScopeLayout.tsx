// The scoped part of the app (decision 57 · I40). `/o/<org>/…` is checked against the
// person's assignments from /api/me before anything is fetched: a scope they are not
// assigned to is "no such page" — the same answer as one that does not exist (C3 · C30).
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Mascot } from '../characters/PenguinIcon';
import { useI18n } from '../i18n';
import { LiveProvider } from '../live/LiveProvider';
import { DeclarativeScreen } from '../screens/DeclarativeScreen';
import { defaultScope, defaultWorkspace, findOrg, findWorkspace, routes, ScopeContext, useScope } from '../scope';
import { useSession } from '../session';
import { ArtifactView } from '../views/ArtifactView';
import { ChatView } from '../views/ChatView';
import { MessengerView } from '../views/MessengerView';
import { OfficeDisplay } from '../views/OfficeDisplay';
import { OfficeView } from '../views/OfficeView';
import { ScheduleView } from '../views/ScheduleView';
import { SettingsView } from '../views/SettingsView';
import { TasksView } from '../views/TasksView';
import { WorkflowRunView, WorkflowsView } from '../views/WorkflowsView';
import { Shell } from './Shell';

/** First path segments of the pre-scope addresses (slice 4) — sent to the current scope. */
export const LEGACY_WS = ['office', 'approvals', 'workflows', 'chat', 'artifacts', 'screens', 'budget', 'home'];

/** Workspace screens the menu of 2026-11-07 folded into others: home → dashboard, the cost
 * screen → the dashboard's cost area, approvals and work products → Task. `:id` is carried over. */
export const MOVED: Record<string, string> = {
  home: '/dashboard',
  budget: '/dashboard#cost',
  approvals: '/tasks',
  artifacts: '/tasks',
  'screens/artifacts': '/tasks',
  'screens/home': '/dashboard',
  'artifacts/:id': '/tasks/artifacts/:id',
  mail: '/messenger',
  // 2026-11-09 — the scheduled runs moved off `schedule`, which the coming calendar menu will take;
  // this redirect is temporary (DESIGN.md `## 컴포넌트` 예약된 작업)
  schedule: '/scheduled-jobs',
};

/** Where a moved workspace address goes now (inside the workspace, `:id` filled in). */
export function movedTarget(pattern: string, params: Record<string, string | undefined>): string {
  return MOVED[pattern].replace(/:(\w+)/g, (_m, name: string) => encodeURIComponent(params[name] ?? ''));
}

function Moved({ from }: { from: string }) {
  const { org, ws = '', ...params } = useParams();
  const location = useLocation();
  const target = routes.ws(org ?? '', ws, movedTarget(from, params));
  const [pathname, hash] = target.split('#');
  return <Navigate to={{ pathname, search: location.search, hash: hash ? `#${hash}` : '' }} replace />;
}
export const LEGACY_ORG = ['org', 'connections', 'settings'];

/** Where an old, unscoped address goes now — null when it is not one of them. */
export function legacyTarget(pathname: string, scope: { org: string; ws: string } | null): string | null {
  if (!scope) return null;
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  if (LEGACY_WS.includes(first)) return routes.ws(scope.org, scope.ws, pathname);
  if (first === 'connections') return routes.org(scope.org, '/settings/connections');
  if (first === 'org') return routes.ws(scope.org, scope.ws, '/office');
  if (LEGACY_ORG.includes(first)) return routes.org(scope.org, pathname);
  return null;
}

export function RootRedirect() {
  const { me } = useSession();
  const target = defaultScope(me);
  if (!target) return <NoAssignment />;
  return <Navigate to={routes.ws(target.org, target.ws)} replace />;
}

export function LegacyRedirect() {
  const { me } = useSession();
  const location = useLocation();
  const to = legacyTarget(location.pathname, defaultScope(me));
  return to ? <Navigate to={`${to}${location.search}`} replace /> : <NotFoundPage />;
}

/** `/o/:org/*` — validate the org (and workspace), then provide the scope to everything below. */
export function ScopeLayout() {
  const { org = '', '*': rest = '' } = useParams();
  const { me } = useSession();
  const orgScope = findOrg(me.scopes, org);
  const wsInPath = rest.match(/^w\/([^/]+)/)?.[1];
  const ws = wsInPath !== undefined ? decodeURIComponent(wsInPath) : null;
  if (!orgScope) return <NotFoundPage />;
  if (ws !== null && !findWorkspace(me.scopes, org, ws)) return <NotFoundPage />;
  const shown = ws ?? defaultWorkspace(me, org);
  if (!shown) return <NotFoundPage />;
  const running = findWorkspace(me.scopes, org, shown)?.running ?? false;
  const scope = { org, ws: shown, inWorkspace: ws !== null };

  const routesInScope = (
    <Routes>
      {/* the office in its own window — the scene and the live work only, outside the shell */}
      <Route path="w/:ws/office/display" element={<WorkspaceGate />}>
        <Route index element={<OfficeDisplay />} />
      </Route>
      <Route element={<Shell />}>
        <Route index element={<Navigate to={routes.ws(org, shown)} replace />} />
        <Route path="w/:ws" element={<WorkspaceGate />}>
          <Route index element={<Navigate to={routes.ws(org, shown, '/dashboard')} replace />} />
          <Route path="dashboard" element={<DeclarativeScreen name="dashboard" />} />
          <Route path="screens/:name" element={<DeclarativeScreen />} />
          <Route path="chat" element={<Navigate to="new" replace />} />
          <Route path="chat/:tid" element={<ChatView />} />
          <Route path="office" element={<OfficeView />} />
          <Route path="messenger" element={<MessengerView />} />
          <Route path="tasks" element={<TasksView />} />
          <Route path="tasks/artifacts/:id" element={<ArtifactView />} />
          <Route path="workflows" element={<WorkflowsView />} />
          <Route path="workflows/:name" element={<WorkflowsView />} />
          <Route path="workflows/:name/runs/:tid" element={<WorkflowRunView />} />
          <Route path="scheduled-jobs" element={<ScheduleView />} />
          {/* the menu of 2026-11-07 — old addresses keep working */}
          {Object.keys(MOVED).map((from) => (
            <Route key={from} path={from} element={<Moved from={from} />} />
          ))}
          <Route path="*" element={<NotFoundInShell />} />
        </Route>
        {/* the org chart moved into the office (2026-11-06) — old addresses keep working */}
        <Route path="org" element={<Navigate to={routes.ws(org, shown, '/office')} replace />} />
        {/* connections moved into Settings (2026-11-06) — old addresses keep working */}
        <Route path="connections" element={<Navigate to={routes.org(org, '/settings/connections')} replace />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="settings/:tab" element={<SettingsView />} />
        <Route path="*" element={<NotFoundInShell />} />
      </Route>
    </Routes>
  );

  return (
    <ScopeContext.Provider value={scope}>
      {running ? <LiveProvider key={`${org}/${shown}`}>{routesInScope}</LiveProvider> : routesInScope}
    </ScopeContext.Provider>
  );
}

/** A workspace that is assigned but whose runtime did not start: say so instead of erroring. */
function WorkspaceGate() {
  const { me } = useSession();
  const scope = useScope();
  const running = findWorkspace(me.scopes, scope.org, scope.ws)?.running ?? false;
  return running ? <Outlet /> : <NotStarted />;
}

export function NotStarted() {
  const { t } = useI18n();
  return (
    <div className="view">
      <div className="panel empty scope-notice" role="status">
        <Mascot size={64} />
        <h1>{t('scope.notStartedTitle')}</h1>
        <p>{t('scope.notStartedBody')}</p>
      </div>
    </div>
  );
}

function NotFoundInShell() {
  const { t } = useI18n();
  return (
    <div className="view">
      <div className="panel empty scope-notice" role="status">
        <h1>{t('scope.notFoundTitle')}</h1>
        <p>{t('scope.notFoundBody')}</p>
      </div>
    </div>
  );
}

/** Outside every assignment — the same page whether the scope exists or not. */
export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <div className="auth-card scope-notice" role="status">
        <Mascot size={64} />
        <h1>{t('scope.notFoundTitle')}</h1>
        <p>{t('scope.notFoundBody')}</p>
        <Link className="btn is-primary is-block" to="/">
          {t('scope.goHome')}
        </Link>
      </div>
    </div>
  );
}

function NoAssignment() {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <div className="auth-card scope-notice" role="status">
        <Mascot size={64} />
        <h1>{t('scope.noAssignmentTitle')}</h1>
        <p>{t('scope.noAssignmentBody')}</p>
      </div>
    </div>
  );
}
