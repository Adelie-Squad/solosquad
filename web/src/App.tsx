import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, setCsrf } from './api/client';
import { useMe } from './api/queries';
import { Enrol } from './auth/Enrol';
import { Login } from './auth/Login';
import { isLocale, useI18n } from './i18n';
import { LiveProvider } from './live/LiveProvider';
import { DeclarativeScreen } from './screens/DeclarativeScreen';
import { SessionContext, sessionFrom } from './session';
import { Shell } from './shell/Shell';
import { ApprovalsView } from './views/ApprovalsView';
import { ArtifactView } from './views/ArtifactView';
import { BudgetView } from './views/BudgetView';
import { ChatView } from './views/ChatView';
import { ConnectionsView } from './views/ConnectionsView';
import { OfficeView } from './views/OfficeView';
import { OrgChartView } from './views/OrgChartView';
import { SettingsView } from './views/SettingsView';
import { WorkflowRunView, WorkflowsView } from './views/WorkflowsView';

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
      <LiveProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<DeclarativeScreen name="home" />} />
            <Route path="screens/:name" element={<DeclarativeScreen />} />
            <Route path="chat" element={<Navigate to="/chat/new" replace />} />
            <Route path="chat/:tid" element={<ChatView />} />
            <Route path="approvals" element={<ApprovalsView />} />
            <Route path="office" element={<OfficeView />} />
            <Route path="org" element={<OrgChartView />} />
            <Route path="workflows" element={<WorkflowsView />} />
            <Route path="workflows/:name" element={<WorkflowsView />} />
            <Route path="workflows/:name/runs/:tid" element={<WorkflowRunView />} />
            <Route path="artifacts/:id" element={<ArtifactView />} />
            <Route path="connections" element={<ConnectionsView />} />
            <Route path="budget" element={<BudgetView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="settings/:tab" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </LiveProvider>
    </SessionContext.Provider>
  );
}
