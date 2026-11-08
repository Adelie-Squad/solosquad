// One session, many windows (the office pop-out beside the main window). Logging out — or the
// session running out — in one window sends every other window of this browser to the login
// as well, so none keeps showing data it may no longer see. The server stays the judge: a
// window that hears "logout" forgets its cache and asks `/me` again.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ApiError } from '../api/client';
import { keys, useMe } from '../api/queries';
import { broadcast, openChannel, SESSION_CHANNEL, type SessionMessage } from '../lib/channels';
import { forgetSession } from './logout';
import { signedIn } from './next';

export function useSessionSync(): void {
  const qc = useQueryClient();
  const me = useMe();
  // true / false once `/me` has answered; null while it is asking
  const signed = me.data ? signedIn(me.data) : me.error instanceof ApiError && me.error.status === 401 ? false : null;
  const now = useRef<boolean | null>(null);
  const before = useRef<boolean | null>(null);
  now.current = signed;

  // the session ended (or began) here — tell the others
  useEffect(() => {
    if (signed === null) return;
    if (before.current === true && !signed) broadcast(SESSION_CHANNEL, { type: 'logout' } satisfies SessionMessage);
    if (before.current === false && signed) broadcast(SESSION_CHANNEL, { type: 'login' } satisfies SessionMessage);
    before.current = signed;
  }, [signed]);

  useEffect(() => {
    const ch = openChannel(SESSION_CHANNEL);
    if (!ch) return;
    const onMessage = (e: MessageEvent<SessionMessage>) => {
      if (e.data?.type === 'logout' && now.current === true) void forgetSession(qc);
      else if (e.data?.type === 'login' && now.current !== true) void qc.invalidateQueries({ queryKey: keys.me });
    };
    ch.addEventListener('message', onMessage);
    return () => {
      ch.removeEventListener('message', onMessage);
      ch.close();
    };
  }, [qc]);

  // a 401 on any other request means the session has run out: ask `/me`, whose 401 shows the login
  useEffect(
    () =>
      qc.getQueryCache().subscribe((ev) => {
        if (ev.type !== 'updated' || ev.action.type !== 'error') return;
        const err = ev.action.error;
        if (err instanceof ApiError && err.status === 401 && ev.query.queryKey[0] !== keys.me[0]) void qc.invalidateQueries({ queryKey: keys.me });
      }),
    [qc],
  );
}
