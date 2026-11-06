// Where the person is working (decision 57 · PRD v2.1.0 I40): the scope lives in the
// address — `/o/<org>/w/<workspace>/…` for a workspace's screens, `/o/<org>/…` for the org's.
// API paths, query-cache keys and the event stream are all derived from it, so two scopes
// never share data on screen, in the cache or on the wire.
import { createContext, useContext } from 'react';
import type { Me, ScopeOrg } from './api/types.gen';
import { SessionContext } from './session';

export interface Scope {
  org: string;
  /** The workspace in the address; on an org-level screen, the one the shell links to. */
  ws: string;
  /** True on `/o/<org>/w/<ws>/…`, false on an org-level screen. */
  inWorkspace: boolean;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const s = useContext(ScopeContext);
  if (!s) throw new Error('useScope outside a scoped screen');
  return s;
}

const enc = encodeURIComponent;

/** API paths (the client adds `/api`). */
export const apiPath = {
  org: (org: string, p: string) => `/o/${enc(org)}${p}`,
  ws: (s: Pick<Scope, 'org' | 'ws'>, p: string) => `/o/${enc(s.org)}/w/${enc(s.ws)}${p}`,
};

/** Web routes. */
export const routes = {
  org: (org: string, p = '') => `/o/${enc(org)}${p}`,
  ws: (org: string, ws: string, p = '') => `/o/${enc(org)}/w/${enc(ws)}${p}`,
};

/** Links inside the current scope: `toWs('/approvals')` → `/o/<org>/w/<ws>/approvals`, `toOrg('/org')` → `/o/<org>/org`. */
export function useLinks() {
  const s = useScope();
  return { w: (p = '') => routes.ws(s.org, s.ws, p), o: (p = '') => routes.org(s.org, p) };
}

/** The scope a bare `/` opens: where the person was last, else the first assignment. */
export function defaultScope(me: Pick<Me, 'scopes' | 'last_scope'>): { org: string; ws: string } | null {
  const last = me.last_scope;
  if (last && findWorkspace(me.scopes, last.org, last.workspace)) return { org: last.org, ws: last.workspace };
  for (const o of me.scopes) if (o.workspaces.length) return { org: o.org, ws: o.workspaces[0].name };
  return null;
}

/** The workspace an org-level screen links to: the last one in that org, else its first. */
export function defaultWorkspace(me: Pick<Me, 'scopes' | 'last_scope'>, org: string): string | null {
  const o = me.scopes.find((x) => x.org === org);
  if (!o || !o.workspaces.length) return null;
  if (me.last_scope?.org === org && o.workspaces.some((w) => w.name === me.last_scope!.workspace)) return me.last_scope.workspace;
  return o.workspaces[0].name;
}

export function findOrg(scopes: ScopeOrg[], org: string): ScopeOrg | undefined {
  return scopes.find((o) => o.org === org);
}

export function findWorkspace(scopes: ScopeOrg[], org: string, ws: string) {
  return findOrg(scopes, org)?.workspaces.find((w) => w.name === ws);
}

/** Owner of this org (or of the whole customer) — what the menus and buttons may show. */
export function isOrgOwner(scopes: ScopeOrg[], org: string): boolean {
  return findOrg(scopes, org)?.role === 'owner';
}

/** The person's role in the org on screen (a customer owner is owner everywhere). */
export function useOrgOwner(): boolean {
  const scope = useScope();
  const session = useContext(SessionContext);
  if (!session) return false;
  return session.me.local || isOrgOwner(session.me.scopes, scope.org);
}
