// The office in its own window (DESIGN.md `## 사무실 장면` — 새 창). The office screen opens
// `…/office/display` with window.open; the two windows talk over one BroadcastChannel per
// workspace. The pop-out says `opened`, beats every second and says `closed` on pagehide; the
// office screen dims while it hears it. Closing is caught three ways so the original never stays
// dimmed by mistake: the window handle's `closed`, the `closed` message, and a heartbeat timeout
// (checked against a Web Lock the pop-out holds while it lives, where the browser has them — a
// hidden window's timers may be throttled, a lock is not).
//
// Data does not travel here: the pop-out runs its own event stream and queries. A change made in
// the main window also posts a `refetch` nudge on DATA_CHANNEL so the pop-out does not wait for
// the server's event.
import { useCallback, useEffect, useRef, useState } from 'react';
import { openChannel } from '../lib/channels';
import { routes } from '../scope';

export type PopoutMessage =
  | { type: 'opened' | 'heartbeat' | 'closed'; id: string }
  | { type: 'ping' | 'focus' | 'close' };

export const HEARTBEAT_MS = 1000;
export const TIMEOUT_MS = 4000;
export const POPOUT_SIZE = { width: 1280, height: 800 };

export const channelName = (org: string, ws: string) => `solosquad-office-${org}-${ws}`;
/** The window name — a second `window.open` with it finds the same window. */
export const windowName = (org: string, ws: string) => `solosquad-office-${org}-${ws}`.replace(/[^\w-]/g, '_');
export const displayPath = (org: string, ws: string) => routes.ws(org, ws, '/office/display');
const features = () => `popup,width=${POPOUT_SIZE.width},height=${POPOUT_SIZE.height}`;

interface LockManagerLike {
  request(name: string, cb: () => Promise<void>): Promise<void>;
  query(): Promise<{ held?: { name?: string }[] }>;
}
const locks = (): LockManagerLike | null =>
  typeof navigator !== 'undefined' ? ((navigator as unknown as { locks?: LockManagerLike }).locks ?? null) : null;

async function lockHeld(name: string): Promise<boolean> {
  try {
    const l = locks();
    if (!l) return false;
    const s = await l.query();
    return (s.held ?? []).some((h) => h.name === name);
  } catch {
    return false;
  }
}

interface ScreenDetailsLike {
  screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number }[];
  currentScreen: unknown;
}

/** On a second screen, when there is one (Window Management API — asks permission the first
 * time). The window is already open, so a refusal or an old browser leaves it where it is. */
async function moveToOtherScreen(w: Window): Promise<void> {
  const ext = (window.screen as Screen & { isExtended?: boolean }).isExtended;
  const get = (window as unknown as { getScreenDetails?: () => Promise<ScreenDetailsLike> }).getScreenDetails;
  if (!ext || typeof get !== 'function') return;
  try {
    const details = await get.call(window);
    const other = details.screens.find((s) => s !== details.currentScreen);
    if (!other || w.closed) return;
    const width = Math.min(POPOUT_SIZE.width, other.availWidth);
    const height = Math.min(POPOUT_SIZE.height, other.availHeight);
    w.moveTo(other.availLeft + Math.round((other.availWidth - width) / 2), other.availTop + Math.round((other.availHeight - height) / 2));
  } catch {
    // permission refused or not available — it stays on this screen
  }
}

export interface Popout {
  /** A pop-out of this workspace is open (in any window of this browser). */
  open: boolean;
  /** The browser refused the last window.open. */
  blocked: boolean;
  /** Open the pop-out — or bring the open one forward. */
  launch: () => void;
  focus: () => void;
  /** Close the pop-out and show the office here again. */
  restore: () => void;
}

/** The office screen's side. */
export function usePopout(org: string, ws: string): Popout {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const handle = useRef<Window | null>(null);
  const seen = useRef(0);
  const chan = useRef<BroadcastChannel | null>(null);
  const name = channelName(org, ws);

  useEffect(() => {
    const ch = openChannel(name);
    chan.current = ch;
    const onMessage = (e: MessageEvent<PopoutMessage>) => {
      const m = e.data;
      if (m?.type === 'opened' || m?.type === 'heartbeat') {
        seen.current = Date.now();
        setOpen(true);
        setBlocked(false);
      } else if (m?.type === 'closed') {
        seen.current = 0;
        setOpen(false);
      }
    };
    ch?.addEventListener('message', onMessage);
    // after a reload of this window: is one already open?
    ch?.postMessage({ type: 'ping' } satisfies PopoutMessage);
    const tick = window.setInterval(() => {
      const h = handle.current;
      if (h && h.closed) {
        handle.current = null;
        seen.current = 0;
        setOpen(false);
        return;
      }
      if (seen.current && Date.now() - seen.current > TIMEOUT_MS) {
        seen.current = 0;
        void lockHeld(name).then((alive) => {
          if (alive) seen.current = Date.now();
          else setOpen(false);
        });
      }
    }, HEARTBEAT_MS / 2);
    return () => {
      window.clearInterval(tick);
      ch?.removeEventListener('message', onMessage);
      ch?.close();
      chan.current = null;
    };
  }, [name]);

  const focus = useCallback(() => {
    let h = handle.current;
    if (!h || h.closed) {
      // after a reload of this window the handle is gone: the window name finds it again
      // (an empty address does not reload it). Called from a click, so it is not blocked.
      h = window.open('', windowName(org, ws), features());
      if (h) {
        try {
          if (h.location.href === 'about:blank') h.location.replace(displayPath(org, ws));
        } catch {
          // not readable — leave it
        }
        handle.current = h;
      }
    }
    h?.focus();
    chan.current?.postMessage({ type: 'focus' } satisfies PopoutMessage);
  }, [org, ws]);

  const launch = useCallback(() => {
    if (open || (handle.current && !handle.current.closed)) {
      focus();
      return;
    }
    const w = window.open(displayPath(org, ws), windowName(org, ws), features());
    if (!w) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    handle.current = w;
    // dim at once — the pop-out's own `opened` follows when its page has loaded
    seen.current = Date.now();
    setOpen(true);
    void moveToOtherScreen(w);
  }, [open, focus, org, ws]);

  const restore = useCallback(() => {
    chan.current?.postMessage({ type: 'close' } satisfies PopoutMessage);
    handle.current?.close();
    handle.current = null;
    seen.current = 0;
    setOpen(false);
  }, []);

  return { open, blocked, launch, focus, restore };
}

/** The pop-out's side: announce, beat, answer, and say goodbye. */
export function usePopoutBeacon(org: string, ws: string): void {
  useEffect(() => {
    const name = channelName(org, ws);
    const ch = openChannel(name);
    if (!ch) return;
    const id = Math.random().toString(36).slice(2);
    const say = (type: 'opened' | 'heartbeat' | 'closed') => {
      try {
        ch.postMessage({ type, id } satisfies PopoutMessage);
      } catch {
        // channel already closed
      }
    };
    const onMessage = (e: MessageEvent<PopoutMessage>) => {
      const m = e.data;
      if (m?.type === 'ping') say('heartbeat');
      else if (m?.type === 'focus') window.focus();
      else if (m?.type === 'close') window.close();
    };
    ch.addEventListener('message', onMessage);
    say('opened');
    const beat = window.setInterval(() => say('heartbeat'), HEARTBEAT_MS);
    const onVisible = () => document.visibilityState === 'visible' && say('heartbeat');
    document.addEventListener('visibilitychange', onVisible);
    const onHide = () => say('closed');
    window.addEventListener('pagehide', onHide);
    // held while this page lives — released by the browser however the window ends
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    void locks()?.request(name, () => held).catch(() => undefined);
    return () => {
      say('closed');
      release();
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      ch.removeEventListener('message', onMessage);
      ch.close();
    };
  }, [org, ws]);
}
