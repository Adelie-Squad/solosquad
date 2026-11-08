import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api/client';
import { keys } from '../api/queries';
import { broadcast, SESSION_CHANNEL, type SessionMessage } from '../lib/channels';
import { LOGIN } from './next';

/** Drop everything this window knows about the session and ask `/me` again — its 401 shows the
 * login. Shared by logging out here and by hearing that another window logged out. */
export function forgetSession(qc: QueryClient): Promise<void> {
  setCsrf(null);
  const relogin = qc.resetQueries({ queryKey: keys.me });
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  return relogin.catch(() => undefined);
}

/**
 * Log out and land on the login screen at once: the server forgets the session, the
 * session's data leaves the cache, and `/me` is asked again — its 401 shows the login. The
 * shell unmounts with it, which closes the event stream. The address becomes `/login` without a
 * history entry, so Back does not bring the old screen back, and the next login opens the
 * last scope. Other windows of this browser (the office pop-out) hear it and do the same.
 */
export async function logOut(qc: QueryClient, go: (to: string) => void): Promise<void> {
  await api.post('/auth/logout').catch(() => undefined);
  broadcast(SESSION_CHANNEL, { type: 'logout' } satisfies SessionMessage);
  const relogin = forgetSession(qc);
  go(LOGIN);
  await relogin;
}

export function useLogout(): () => Promise<void> {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return () => logOut(qc, (to) => navigate(to, { replace: true }));
}
