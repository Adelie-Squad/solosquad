// The demo's answer to the web's transport seam (api/transport.ts): every `/api/…` request the
// screens make goes to the in-browser engine instead of a server, and each event stream is the
// engine's own event bus. Only the demo login's `/api/demo/*` reaches the network (session.ts).
import type { Transport } from '../api/transport';
import type { EventSourceLike } from '../live/stream';
import type { DemoEngine } from './engine';

/** A short wait, so the screens show their loading states as they would against a server. */
const LATENCY_MS = 60;

const respond = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class EngineEvents implements EventSourceLike {
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent<string>) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  private off: (() => void) | null;

  constructor(engine: DemoEngine, workspace: boolean) {
    this.off = workspace
      ? engine.subscribe((ev, id) => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev), lastEventId: String(id) })))
      : null;
    setTimeout(() => this.onopen?.(new Event('open')), 0);
  }

  close(): void {
    this.off?.();
    this.off = null;
  }
}

export function demoTransport(engine: () => DemoEngine): Transport {
  return {
    async fetch(url, init) {
      const u = new URL(url, window.location.origin);
      const path = u.pathname.replace(/^\/api/, '');
      let body: unknown = null;
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = null;
        }
      } else if (init.body) {
        // an upload: the demo runs on its example files only
        return respond(403, { error: 'forbidden', code: 'forbidden', params: {} });
      }
      await new Promise((r) => setTimeout(r, LATENCY_MS));
      const answer = engine().handle((init.method ?? 'GET').toUpperCase(), path, u.searchParams, body);
      return respond(answer.status, answer.body);
    },
    events(url) {
      // the workspace stream carries the runs; the calendar's stream has nothing to say here
      return new EngineEvents(engine(), /\/events$/.test(new URL(url, window.location.origin).pathname) && url.includes('/w/'));
    },
  };
}
