// The account screens (decision 60): `/dashboard` · `/calendar` · `/messenger` belong to the whole
// company, above the business (org) level, and filter by business and workspace inside. The
// shell around them still needs a workspace for its lower group (office · Tasks · workflows) and
// the conversations: the one picked in this tab, else the person's last scope.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { LiveProvider } from '../live/LiveProvider';
import { defaultScope, findWorkspace, PickedScopeContext, ScopeContext, usePickedScope } from '../scope';
import { useSession } from '../session';
import { NoAssignment } from './ScopeLayout';
import { Shell } from './Shell';

/** Holds the picked workspace for the whole signed-in app (account and workspace screens). */
export function PickedScopeProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<{ org: string; ws: string } | null>(null);
  const pick = useCallback((s: { org: string; ws: string }) => {
    setPicked((p) => (p && p.org === s.org && p.ws === s.ws ? p : s));
  }, []);
  const value = useMemo(() => ({ picked, pick }), [picked, pick]);
  return <PickedScopeContext.Provider value={value}>{children}</PickedScopeContext.Provider>;
}

/** The workspace an account screen's sidebar points to (valid for this person, else their default). */
export function useAccountScope(): { org: string; ws: string } | null {
  const { me } = useSession();
  const { picked } = usePickedScope();
  if (picked && findWorkspace(me.scopes, picked.org, picked.ws)) return picked;
  return defaultScope(me);
}

export function AccountLayout() {
  const { me } = useSession();
  const target = useAccountScope();
  if (!target) return <NoAssignment />;
  const scope = { org: target.org, ws: target.ws, inWorkspace: false, account: true };
  const running = findWorkspace(me.scopes, target.org, target.ws)?.running ?? false;
  const shell = (
    <Shell>
      <Outlet />
    </Shell>
  );
  return (
    <ScopeContext.Provider value={scope}>
      {running ? <LiveProvider key={`${target.org}/${target.ws}`}>{shell}</LiveProvider> : shell}
    </ScopeContext.Provider>
  );
}
