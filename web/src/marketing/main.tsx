// The marketing build's entry (`vite build --mode marketing` → site/public, decision 62).
import { StrictMode } from 'react';
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

enableThemeTransitions();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <LucideProvider {...ICON_DEFAULTS}>
        <BrowserRouter>
          <MarketingApp />
        </BrowserRouter>
      </LucideProvider>
    </I18nProvider>
  </StrictMode>,
);
