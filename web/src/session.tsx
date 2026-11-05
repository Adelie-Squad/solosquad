import { createContext, useContext } from 'react';
import type { Me, PublicUser } from './api/types.gen';

export interface Session {
  me: Me;
  user: PublicUser | null;
  /** Owner (대표) — or the local CLI token, which acts as the owner on its own machine. */
  isOwner: boolean;
}

export const SessionContext = createContext<Session | null>(null);

export function sessionFrom(me: Me): Session {
  return { me, user: me.user, isOwner: me.local || me.user?.role === 'owner' };
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside a logged-in shell');
  return s;
}
