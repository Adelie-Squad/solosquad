// Where to go after logging in (DESIGN.md `## 레이아웃` — 주소). `/login?next=<app path>`
// brings a person back to the address they opened; anything that is not a path on this
// origin (`//evil.example`, `https://…`, `/\evil`, a scheme) is dropped for the last scope.
import type { Me } from '../api/types.gen';
import { defaultScope, routes } from '../scope';

export const LOGIN = '/login';

/** The `next` value when it is a same-origin app path, else null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, 'https://office.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://office.invalid') return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path === '/' || path === LOGIN || path.startsWith(`${LOGIN}?`) || path.startsWith(`${LOGIN}/`)) return null;
  return path;
}

/** `/login?next=<address>` for an address a signed-out person opened. */
export function loginFor(address: string): string {
  const next = safeNext(address);
  return next ? `${LOGIN}?next=${encodeURIComponent(next)}` : LOGIN;
}

/** Where a person lands: the account dashboard (decision 60) — its sidebar points at the last
 * scope they used, else their first assignment — or `/o` (which says that nothing is assigned yet). */
export function officeHref(me: Pick<Me, 'scopes' | 'last_scope'>): string {
  return defaultScope(me) ? ACCOUNT_HOME : '/o';
}

/** The first account screen. */
export const ACCOUNT_HOME = '/dashboard';

/** The last scope's own workspace address (the office), for links that want a workspace. */
export function workspaceHref(me: Pick<Me, 'scopes' | 'last_scope'>): string {
  const s = defaultScope(me);
  return s ? routes.ws(s.org, s.ws) : '/o';
}

/** Logged in for the app: a real session past enrolment (or the local CLI token). */
export function signedIn(me: Me | undefined): boolean {
  return !!me && !me.relogin && (!!me.user || me.local) && me.stage !== 'enroll';
}
