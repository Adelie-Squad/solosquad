// The office pop-out in the demo (2026-11-14 — "사무실 새창 열기는 왜 숨긴거지? 할 수 있게 해줘").
// The demo keeps everything in the memory of one window, so a second window cannot be a demo of its
// own — it would be a separate company that never sees the first one's approvals. Instead the
// pop-out (`…/office/display`) borrows the opener's engine: every `/api/…` request it makes is
// answered by the opener's engine, and the opener's engine events are its event stream. Approving
// in either window is the same approval.
//
// They talk over one BroadcastChannel per demo account (same origin only — `solosquad-demo:<id>`);
// each message names the host (the opener's current engine), so a second demo tab of the same
// account is not mixed in. The pop-out finds its host through `window.opener` when it can (else
// the first host to answer). The host says `bye` on pagehide and holds a Web Lock while it lives;
// the pop-out waits on that lock (a hidden window's timers may sleep, a lock does not) and also
// watches `window.opener.closed`. When the host is gone the pop-out says so and offers to close or
// go back to the demo — it never starts a demo of its own. "처음 상태로" in the opener is a new
// engine: the host says `reset` and the pop-out follows it.
import type { Transport } from '../api/transport';
import { openChannel } from '../lib/channels';
import type { EventSourceLike } from '../live/stream';
import type { DemoEngine } from './engine';

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  close(): void;
}

export type LinkMessage =
  | { type: 'hello'; want: string | null }
  | { type: 'here'; host: string; locale: string }
  | { type: 'req'; host: string; id: string; method: string; path: string; query: string; body: unknown }
  | { type: 'res'; host: string; id: string; status: number; body: unknown }
  | { type: 'ev'; host: string; ev: unknown; eid: number }
  | { type: 'reset'; host: string; next: string; locale: string }
  | { type: 'bye'; host: string };

export const channelFor = (demoId: string) => `solosquad-demo:${demoId.toLowerCase()}`;
const lockFor = (host: string) => `solosquad-demo-host:${host}`;
/** The opener's current host id, for its pop-out to find (same origin, so it can read it). */
const OPENER_KEY = '__solosquadDemoHost';

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

interface LockManagerLike {
  request(name: string, cb: () => Promise<void>): Promise<void>;
}
const locks = (): LockManagerLike | null => (typeof navigator !== 'undefined' ? ((navigator as unknown as { locks?: LockManagerLike }).locks ?? null) : null);

type Open = (name: string) => ChannelLike | null;

/**
 * The opener's side: answer the pop-out's requests from `engine()` and pass its events on. Call
 * `swap()` after "처음 상태로" (a new engine). Returns the way to stop (pagehide says `bye` too).
 */
export function hostDemo(demoId: string, engine: () => DemoEngine, locale: () => string, open: Open = openChannel): { swap: () => void; stop: () => void } {
  const ch = open(channelFor(demoId));
  if (!ch) return { swap: () => undefined, stop: () => undefined };
  let host = newId();
  let off: (() => void) | null = null;
  let release: () => void = () => undefined;
  const say = (m: LinkMessage) => {
    try {
      ch.postMessage(m);
    } catch {
      // closed under us
    }
  };
  const hold = () => {
    release();
    const held = new Promise<void>((r) => (release = r));
    void locks()?.request(lockFor(host), () => held).catch(() => undefined);
    (window as unknown as Record<string, string>)[OPENER_KEY] = host;
  };
  const listen = () => {
    off?.();
    off = engine().subscribe((ev, eid) => say({ type: 'ev', host, ev, eid }));
  };
  const onMessage = (e: MessageEvent) => {
    const m = e.data as LinkMessage;
    if (m?.type === 'hello' && (!m.want || m.want === host)) say({ type: 'here', host, locale: locale() });
    else if (m?.type === 'req' && m.host === host) {
      let answer: { status: number; body: unknown };
      try {
        answer = engine().handle(m.method, m.path, new URLSearchParams(m.query), m.body);
      } catch {
        answer = { status: 500, body: { error: 'server_error', code: 'server_error', params: {} } };
      }
      say({ type: 'res', host, id: m.id, status: answer.status, body: answer.body });
    }
  };
  const bye = () => say({ type: 'bye', host });
  ch.addEventListener('message', onMessage);
  window.addEventListener('pagehide', bye);
  hold();
  listen();
  return {
    swap() {
      const next = newId();
      say({ type: 'reset', host, next, locale: locale() });
      host = next;
      hold();
      listen();
    },
    stop() {
      bye();
      off?.();
      release();
      window.removeEventListener('pagehide', bye);
      ch.removeEventListener('message', onMessage);
      ch.close();
    },
  };
}

/** The pop-out's side, once a host has answered. */
export interface DemoLink {
  host: () => string;
  locale: string;
  transport: Transport;
  /** Called once when the host is gone (closed · reloaded · signed out). */
  onGone: (fn: () => void) => void;
  /** Called when the host started over (a new engine) — ask everything again. */
  onReset: (fn: () => void) => void;
  close: () => void;
}

const REQUEST_TIMEOUT_MS = 8000;
const LATENCY_MS = 40;

class LinkedEvents implements EventSourceLike {
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent<string>) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  constructor(link: { subscribe: (fn: (ev: unknown, eid: number) => void) => () => void }, workspace: boolean) {
    this.off = workspace ? link.subscribe((ev, eid) => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev), lastEventId: String(eid) }))) : null;
    setTimeout(() => this.onopen?.(new Event('open')), 0);
  }
  private off: (() => void) | null;
  close(): void {
    this.off?.();
    this.off = null;
  }
}

const respond = (status: number, body: unknown) => new Response(body === undefined || body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The host this window was opened by, when the opener is a demo window of this origin. */
function openerHost(): string | null {
  try {
    const v = (window.opener as Record<string, unknown> | null)?.[OPENER_KEY];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The pop-out's side: find the host (the opener's demo) within `waitMs`, then a transport that
 * asks it. Null when there is none — the opener is gone or is not a demo window.
 */
export function joinDemo(demoId: string, opts: { open?: Open; waitMs?: number; want?: string | null } = {}): Promise<DemoLink | null> {
  const ch = (opts.open ?? openChannel)(channelFor(demoId));
  if (!ch) return Promise.resolve(null);
  const want = opts.want === undefined ? openerHost() : opts.want;
  return new Promise((resolve) => {
    let host: string | null = null;
    let locale = 'ko';
    let gone = false;
    const pending = new Map<string, (r: Response) => void>();
    const listeners = new Set<(ev: unknown, eid: number) => void>();
    const goneFns: (() => void)[] = [];
    const resetFns: (() => void)[] = [];
    const say = (m: LinkMessage) => {
      try {
        ch.postMessage(m);
      } catch {
        // closed
      }
    };
    const markGone = () => {
      if (gone || !host) return;
      gone = true;
      for (const [, done] of pending) done(respond(503, { error: 'unavailable', code: 'unavailable', params: {} }));
      pending.clear();
      for (const fn of goneFns) fn();
    };
    const watch = () => {
      // the lock is released however the host's page ends
      const l = locks();
      const name = lockFor(host!);
      if (l) void l.request(name, async () => (host && lockFor(host) === name ? markGone() : undefined)).catch(() => undefined);
    };
    const onMessage = (e: MessageEvent) => {
      const m = e.data as LinkMessage;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'here' && !host && (!want || m.host === want)) {
        host = m.host;
        locale = m.locale;
        clearTimeout(timer);
        watch();
        resolve(link);
        return;
      }
      if (!host || !('host' in m) || m.host !== host) return;
      if (m.type === 'res') {
        pending.get(m.id)?.(respond(m.status, m.body));
        pending.delete(m.id);
      } else if (m.type === 'ev') {
        for (const fn of listeners) fn(m.ev, m.eid);
      } else if (m.type === 'reset') {
        host = m.next;
        locale = m.locale;
        watch();
        for (const fn of resetFns) fn();
      } else if (m.type === 'bye') markGone();
    };
    ch.addEventListener('message', onMessage);
    const openerTick = window.setInterval(() => {
      try {
        if (window.opener && (window.opener as Window).closed) markGone();
      } catch {
        // not readable
      }
    }, 1000);
    const close = () => {
      window.clearInterval(openerTick);
      clearTimeout(timer);
      ch.removeEventListener('message', onMessage);
      ch.close();
    };
    const timer = setTimeout(() => {
      close();
      resolve(null);
    }, opts.waitMs ?? 1500);

    const ask = (method: string, path: string, query: string, body: unknown) =>
      new Promise<Response>((done) => {
        if (gone || !host) return done(respond(503, { error: 'unavailable', code: 'unavailable', params: {} }));
        const id = newId();
        pending.set(id, done);
        setTimeout(() => {
          if (pending.delete(id)) done(respond(504, { error: 'timeout', code: 'timeout', params: {} }));
        }, REQUEST_TIMEOUT_MS);
        say({ type: 'req', host, id, method, path, query, body });
      });

    const link: DemoLink = {
      host: () => host ?? '',
      get locale() {
        return locale;
      },
      transport: {
        async fetch(url, init) {
          const u = new URL(url, window.location.origin);
          let body: unknown = null;
          if (typeof init.body === 'string') {
            try {
              body = JSON.parse(init.body);
            } catch {
              body = null;
            }
          } else if (init.body) return respond(403, { error: 'forbidden', code: 'forbidden', params: {} });
          await new Promise((r) => setTimeout(r, LATENCY_MS));
          return ask((init.method ?? 'GET').toUpperCase(), u.pathname.replace(/^\/api/, ''), u.searchParams.toString(), body);
        },
        events(url) {
          const workspace = /\/events$/.test(new URL(url, window.location.origin).pathname) && url.includes('/w/');
          return new LinkedEvents(
            {
              subscribe: (fn) => {
                listeners.add(fn);
                return () => listeners.delete(fn);
              },
            },
            workspace,
          );
        },
      },
      onGone: (fn) => {
        if (gone) fn();
        else goneFns.push(fn);
      },
      onReset: (fn) => resetFns.push(fn),
      close,
    };
    say({ type: 'hello', want });
  });
}

/** This window is a demo pop-out (the office display route). */
export const isPopoutPath = (pathname: string) => /\/office\/display\/?$/.test(pathname);
