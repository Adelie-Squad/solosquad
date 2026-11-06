import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ApiError, setCsrf } from './api/client';
import { useMe } from './api/queries';
import { Enrol } from './auth/Enrol';
import { Login } from './auth/Login';
import { isLocale, useI18n } from './i18n';
import { SessionContext, sessionFrom } from './session';
import { LegacyRedirect, RootRedirect, ScopeLayout } from './shell/ScopeLayout';

export function App() {
  const me = useMe();
  const { t, setLocale } = useI18n();

  useEffect(() => {
    if (me.data) {
      setCsrf(me.data.csrf);
      if (isLocale(me.data.locale)) setLocale(me.data.locale);
    }
  }, [me.data, setLocale]);

  if (me.isPending) return <div className="splash">{t('common.loading')}</div>;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
    if (me.error instanceof ApiError && me.error.status === 403) return <div className="splash">{t('auth.blocked')}</div>;
    return <div className="splash">{t('common.offline')}</div>;
  }
  if (me.data.relogin || (!me.data.user && !me.data.local)) return <Login />;
  if (me.data.stage === 'enroll') return <Enrol />;

  return (
    <SessionContext.Provider value={sessionFrom(me.data)}>
      <AppRoutes />
    </SessionContext.Provider>
  );
}

/** Addresses: `/` → the last scope · `/o/<org>/…` scoped screens · old unscoped addresses → the current scope. */
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<RootRedirect />} />
      <Route path="o/:org/*" element={<ScopeLayout />} />
      <Route path="*" element={<LegacyRedirect />} />
    </Routes>
  );
}
