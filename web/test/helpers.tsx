import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalItem, Me } from '../src/api/types.gen';
import { I18nProvider, type Locale } from '../src/i18n';
import { ScopeContext, type Scope } from '../src/scope';
import { SessionContext, sessionFrom } from '../src/session';

/** Two orgs, three workspaces — the decision-57 demo shape. */
export function me(over: Partial<Me> = {}): Me {
  return {
    user: { id: 'u-1', username: 'boss', display: 'Boss', role: 'owner', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [] },
    stage: 'full',
    csrf: 'c',
    local: false,
    locale: 'ko',
    org_locale: 'ko',
    relogin: false,
    scopes: [
      { org: 'tesla', display: 'Tesla', role: 'owner', whole_org: true, workspaces: [{ name: 'charging', role: 'owner', running: true }, { name: 'vehicles', role: 'owner', running: true }] },
      { org: 'spacexai', display: 'SpaceXAI', role: 'owner', whole_org: true, workspaces: [{ name: 'hq', role: 'owner', running: false }] },
    ],
    last_scope: null,
    ...over,
  };
}

export function renderWith(ui: ReactNode, locale: Locale = 'ko', opts: { scope?: Scope; me?: Me; path?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = opts.scope ?? { org: 'tesla', ws: 'charging', inWorkspace: true };
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <SessionContext.Provider value={sessionFrom(opts.me ?? me())}>
          <ScopeContext.Provider value={scope}>
            <MemoryRouter initialEntries={[opts.path ?? '/']}>{ui}</MemoryRouter>
          </ScopeContext.Provider>
        </SessionContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

export function approval(over: Partial<ApprovalItem> = {}, card: Partial<ApprovalItem['card']> = {}): ApprovalItem {
  return {
    source: 'company',
    thread_id: 'th-1',
    run_id: 'run-1',
    created: Date.now() / 1000,
    tier: 'team',
    can_approve: true,
    ...over,
    card: {
      kind: 'approval',
      title: 'chief wants to: send the report',
      summary: 'monthly report',
      reason: 'send',
      options: ['approved', 'declined'],
      risk: 'low',
      agent: 'chief',
      category: 'review',
      team: 'core',
      workflow: null,
      step: null,
      ...card,
    },
  };
}
