import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER, setCsrf } from '../src/api/client';
import { ApprovalCard, blockedReason } from '../src/components/ApprovalCard';
import { translate } from '../src/i18n';
import { approval, renderWith } from './helpers';

describe('approval card buttons follow can_approve (decision 51)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows approve and decline when the server says I may answer', () => {
    renderWith(<ApprovalCard item={approval({ can_approve: true })} />);
    expect(screen.getByRole('button', { name: translate('ko', 'approvals.approve') })).toBeTruthy();
    expect(screen.getByRole('button', { name: translate('ko', 'approvals.decline') })).toBeTruthy();
    expect(screen.queryByTestId('approval-blocked')).toBeNull();
  });

  it('hides the buttons and says why for an owner-tier card', () => {
    renderWith(<ApprovalCard item={approval({ can_approve: false, tier: 'owner' }, { category: 'transfer' })} />);
    expect(screen.queryByRole('button', { name: translate('ko', 'approvals.approve') })).toBeNull();
    expect(screen.getByTestId('approval-blocked').textContent).toContain(translate('ko', 'approvals.needsOwner'));
  });

  it('names the team for a team-tier card outside my teams', () => {
    const item = approval({ can_approve: false, tier: 'team' }, { team: 'sales' });
    expect(blockedReason(item)).toEqual({ key: 'approvals.needsTeam', team: 'sales' });
    renderWith(<ApprovalCard item={item} />, 'en');
    expect(screen.getByTestId('approval-blocked').textContent).toContain('Members of team Sales');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('answers through the right route with the CSRF token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ run_id: 'r2' }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    setCsrf('csrf-1');
    renderWith(<ApprovalCard item={approval({ source: 'workflow', thread_id: 'wf-th' }, { workflow: 'monthly-pnl' })} />, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // the card also reads the agents (for their display names) — find the answer itself
    const calls = () => (fetch.mock.calls as unknown as [string, RequestInit][]).filter(([u]) => u.endsWith('/resume'));
    await waitFor(() => expect(calls()).toHaveLength(1));
    const [url, init] = calls()[0];
    expect(url).toBe('/api/o/tesla/w/charging/workflow-threads/wf-th/resume'); // the workspace on screen
    expect(JSON.parse(String(init.body))).toEqual({ value: 'approved' });
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('csrf-1');
  });
});
