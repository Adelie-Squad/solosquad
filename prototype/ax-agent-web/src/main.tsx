import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/global.css';
import { RequireCategory } from './components/NoAccess';
import { Landing } from './pages/Landing';
import { Workspace } from './pages/Workspace';
import { DashboardView } from './views/DashboardView';
import { HomeView } from './views/HomeView';
import { LiveView } from './views/LiveView';
import { MailView } from './views/MailView';
import { OfficeView } from './views/OfficeView';
import { TasksView } from './views/TasksView';
import { SchedulerView } from './views/SchedulerView';
import { WorkflowsView } from './views/WorkflowsView';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Workspace />}>
          <Route index element={<HomeView />} />
          <Route path="live" element={<LiveView />} />
          <Route path="office" element={<OfficeView />} />
          <Route path="office/dashboard" element={<DashboardView />} />
          {/* 예전 '대시보드' 메뉴 주소 — 사무실의 대시보드 버튼 뒤로 옮겼다 */}
          <Route path="dashboard" element={<Navigate to="/app/office/dashboard" replace />} />
          <Route
            path="mail"
            element={
              <RequireCategory category="haru">
                <MailView />
              </RequireCategory>
            }
          />
          <Route path="tasks" element={<TasksView />} />
          <Route path="scheduler" element={<SchedulerView />} />
          <Route path="workflows" element={<WorkflowsView />} />
          <Route path="workflows/:id" element={<WorkflowsView />} />
          {/* 예전 '재무' 화면 주소 — 재무 관리 워크플로우로 옮겼다 */}
          <Route path="finance" element={<Navigate to="/app/workflows/finance" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
