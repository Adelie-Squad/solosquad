import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError, setCsrf } from './api/client';
import { useMe } from './api/queries';
import { Enrol } from './auth/Enrol';
import { Login } from './auth/Login';
import { LOGIN, loginFor, officeHref, safeNext, signedIn } from './auth/next';
import { useSessionSync } from './auth/sessionSync';
import { isLocale, useI18n } from './i18n';
import { SessionContext, sessionFrom } from './session';
import { CalendarLive } from './live/CalendarLive';
import { AccountLayout, PickedScopeProvider } from './shell/AccountLayout';
import { LegacyRedirect, RootRedirect, ScopeLayout } from './shell/ScopeLayout';
import { AccountDashboard } from './views/AccountDashboard';
import { MessengerView } from './views/MessengerView';

// the calendar is its own chunk — month · week · list, the drawer and the settings
const CalendarView = lazy(() => import('./views/calendar/CalendarView').then((m) => ({ default: m.CalendarView })));

/**
 * Addresses (DESIGN.md `## 레이아웃`): `/` → this server's login, or the account dashboard when
 * signed in (decision 62 — the landing lives only on the marketing site, `src/marketing.tsx`) ·
 * `/login` login and first-login enrolment · `/o/<org>/…` the app. A signed-out visit to an
 * app address goes to `/login?next=<it>`; after login, `next` (same-origin paths only) or
 * the last scope.
 */
export function App() {
  const me = useMe();
  const { setLocale } = useI18n();
  useSessionSync();

  useEffect(() => {
    if (me.data) {
      setCsrf(me.data.csrf);
      if (isLocale(me.data.locale)) setLocale(me.data.locale);
    }
  }, [me.data, setLocale]);

  return (
    <Routes>
      <Route index element={<RootRoute />} />
      <Route path="login" element={<LoginRoute />} />
      <Route path="*" element={<AppRoute />} />
    </Routes>
  );
}

/** What `/api/me` says when it did not answer with a person: splash, blocked or offline. */
function MeProblem() {
  const me = useMe();
  const { t } = useI18n();
  if (me.isPending) return <div className="splash">{t('common.loading')}</div>;
  if (me.error instanceof ApiError && me.error.status === 403) return <div className="splash">{t('auth.blocked')}</div>;
  return <div className="splash">{t('common.offline')}</div>;
}

const loggedOut = (error: unknown) => error instanceof ApiError && error.status === 401;

/** `/` on a company server: its login, or where a signed-in person lands. */
function RootRoute() {
  const me = useMe();
  if (me.isPending || (me.error && !loggedOut(me.error))) return <MeProblem />;
  return <Navigate to={me.data && signedIn(me.data) ? officeHref(me.data) : LOGIN} replace />;
}

function LoginRoute() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.isPending || (me.error && !loggedOut(me.error))) return <MeProblem />;
  if (me.data && signedIn(me.data)) return <Navigate to={safeNext(params.get('next')) ?? officeHref(me.data)} replace />;
  if (me.data && !me.data.relogin && me.data.stage === 'enroll') return <Enrol />;
  return <Login />;
}

function AppRoute() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending || (me.error && !loggedOut(me.error))) return <MeProblem />;
  if (!me.data || !signedIn(me.data)) return <Navigate to={loginFor(`${location.pathname}${location.search}${location.hash}`)} replace />;
  return (
    <SessionContext.Provider value={sessionFrom(me.data)}>
      <AppRoutes />
    </SessionContext.Provider>
  );
}

/** Signed-in addresses: the account screens (`/dashboard` · `/calendar` · `/messenger`, decision 60) ·
 * `/o` → the last scope · `/o/<org>/…` scoped screens · old unscoped addresses → the current scope. */
export function AppRoutes() {
  return (
    <PickedScopeProvider>
      <CalendarLive />
      <Routes>
        <Route element={<AccountLayout />}>
          <Route path="dashboard" element={<AccountDashboard />} />
          <Route
            path="calendar"
            element={
              <Suspense fallback={<div className="view" />}>
                <CalendarView />
              </Suspense>
            }
          />
          <Route path="messenger" element={<MessengerView />} />
        </Route>
        <Route path="o" element={<RootRedirect />} />
        <Route path="o/:org/*" element={<ScopeLayout />} />
        <Route path="*" element={<LegacyRedirect />} />
      </Routes>
    </PickedScopeProvider>
  );
}
