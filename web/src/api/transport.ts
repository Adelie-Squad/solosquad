// How the web reaches the engine: `fetch` for the API and `EventSource` for the event streams.
// Everything goes through here, so a page that hosts these screens somewhere else (the marketing
// site's demo) can answer them itself — the components never know. The customer build never
// replaces it.
import type { EventSourceLike } from '../live/stream';

export interface Transport {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  events: (url: string) => EventSourceLike;
}

const browser: Transport = {
  fetch: (url, init) => fetch(url, init),
  events: (url) => new EventSource(url, { withCredentials: true }),
};

let current: Transport = browser;

export function setTransport(next: Transport | null): void {
  current = next ?? browser;
}

export const transport = (): Transport => current;
