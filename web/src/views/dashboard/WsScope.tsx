// The account dashboard shows rows from many workspaces. A row that acts (approve · check) or
// links inside one — the same components 과제 uses — gets that workspace as its scope.
import type { ReactNode } from 'react';
import { routes, ScopeContext } from '../../scope';

export interface WsRef {
  org: string;
  ws: string;
  orgDisplay: string;
  wsDisplay: string;
  running: boolean;
}

export function WsScope({ org, ws, children }: { org: string; ws: string; children: ReactNode }) {
  return <ScopeContext.Provider value={{ org, ws, inWorkspace: true }}>{children}</ScopeContext.Provider>;
}

/** `사업 · 워크스페이스` — where a row comes from. */
export const From = ({ r }: { r: Pick<WsRef, 'orgDisplay' | 'wsDisplay'> }) => <span className="from-scope">{`${r.orgDisplay} · ${r.wsDisplay}`}</span>;

/** A link builder for one workspace — what `useLinks().w` is inside a scope. */
export const wsLinks = (org: string, ws: string) => (p = '') => routes.ws(org, ws, p);
