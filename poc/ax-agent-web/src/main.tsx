import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles/global.css';
import { Landing } from './pages/Landing';
import { Workspace } from './pages/Workspace';
import { HomeView } from './views/HomeView';
import { LiveView } from './views/LiveView';
import { MailView } from './views/MailView';
import { TasksView } from './views/TasksView';
import { SchedulerView } from './views/SchedulerView';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Workspace />}>
          <Route index element={<HomeView />} />
          <Route path="live" element={<LiveView />} />
          <Route path="mail" element={<MailView />} />
          <Route path="tasks" element={<TasksView />} />
          <Route path="scheduler" element={<SchedulerView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
