import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api/client';
import { keys } from '../api/queries';
import { LOGIN } from './next';

/**
 * Log out and land on the login screen at once: the server forgets the session, the
 * session's data leaves the cache, and `/me` is asked again — its 401 shows the login. The
 * shell unmounts with it, which closes the event stream. The address becomes `/login` without a
 * history entry, so Back does not bring the old screen back, and the next login opens the
 * last scope.
 */
export async function logOut(qc: QueryClient, go: (to: string) => void): Promise<void> {
  await api.post('/auth/logout').catch(() => undefined);
  setCsrf(null);
  const relogin = qc.resetQueries({ queryKey: keys.me });
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  go(LOGIN);
  await relogin.catch(() => undefined);
}

export function useLogout(): () => Promise<void> {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return () => logOut(qc, (to) => navigate(to, { replace: true }));
}
