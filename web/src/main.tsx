import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LucideProvider } from 'lucide-react';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiError } from './api/client';
import { I18nProvider } from './i18n';
import { ICON_DEFAULTS } from './icons';
import { watchPresence } from './lib/presence';
import { enableThemeTransitions } from './theme';
import './styles/tokens.css';
import './styles/global.css';
import './styles/Workspace.css';
import './styles/views.css';
import './styles/HomeView.css';
import './styles/OfficeView.css';
import './styles/app.css';
import './styles/design.css';
import './styles/screens.css';
import './styles/calendar.css';
import './styles/demo.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // a 401/403/404 will not get better by asking again
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

enableThemeTransitions();
watchPresence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <LucideProvider {...ICON_DEFAULTS}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LucideProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
