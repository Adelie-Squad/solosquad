// The marketing build's entry (`vite build --mode marketing` → marketing/public, decision 62).
// /demo/app/… is the demo itself (src/demo, 2026-11-13): the customer web's screens under their own
// router (basename /demo/app), loaded on its own — the landing never downloads it.
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { LucideProvider } from 'lucide-react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { ICON_DEFAULTS } from '../icons';
import { MarketingApp } from './MarketingApp';
import { enableThemeTransitions } from '../theme';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/Workspace.css';
import '../styles/views.css';
import '../styles/OfficeView.css';
import '../styles/app.css';
import '../styles/design.css';
import '../styles/site.css';

const DemoApp = lazy(() => import('../demo/DemoApp'));
const DEMO_APP = '/demo/app';
const inDemo = window.location.pathname === DEMO_APP || window.location.pathname.startsWith(`${DEMO_APP}/`);

enableThemeTransitions();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <LucideProvider {...ICON_DEFAULTS}>
        {inDemo ? (
          <BrowserRouter basename={DEMO_APP}>
            <Suspense fallback={<div className="splash" />}>
              <DemoApp />
            </Suspense>
          </BrowserRouter>
        ) : (
          <BrowserRouter>
            <MarketingApp />
          </BrowserRouter>
        )}
      </LucideProvider>
    </I18nProvider>
  </StrictMode>,
);
