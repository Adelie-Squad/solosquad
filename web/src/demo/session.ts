// The demo's only calls to the network: the marketing Worker's demo session (marketing/src/demo.ts).
// Who is signed in (the account's company name, first language and end), the usage events
// (a screen viewed, a button pressed — never what was typed), and logging out. They go straight to
// `fetch`, past the transport seam the screens use (that one answers from memory).

export interface DemoSessionInfo {
  demo_id: string;
  company_name: string;
  locale: string;
  /** the account's end (ISO) */
  expires: string;
}

export const DEMO_LOGIN = '/demo';
export const DEMO_APP = '/demo/app';

/** The signed-in demo account, or null (no session, expired or revoked). Throws when the site does not answer. */
export async function demoSession(): Promise<DemoSessionInfo | null> {
  const r = await fetch('/api/demo/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as DemoSessionInfo;
}

/** A usage event — fire and forget; a failure is never in the way. */
export function demoEvent(kind: 'view' | 'action', detail: string): void {
  const clean = detail.replace(/[^A-Za-z0-9_.:/-]/g, '').slice(0, 80);
  if (!clean) return;
  void fetch('/api/demo/event', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, detail: clean }),
    keepalive: true,
  }).catch(() => undefined);
}

/** A screen's address without the ids in it (`/o/moa/w/hq/tasks/artifacts/:id`). */
export const viewDetail = (pathname: string) => pathname.replace(/\/(th|run|art|ci|ct)-[A-Za-z0-9-]+/g, '/:id') || '/';

export async function demoLogout(): Promise<void> {
  await fetch('/api/demo/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}
