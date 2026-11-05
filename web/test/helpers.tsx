import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalItem } from '../src/api/types.gen';
import { I18nProvider, type Locale } from '../src/i18n';

export function renderWith(ui: ReactNode, locale: Locale = 'ko') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <MemoryRouter>{ui}</MemoryRouter>
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
