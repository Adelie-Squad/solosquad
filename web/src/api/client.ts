// The one way the web talks to the engine — same origin, cookie session (PRD v2.1.0 I20 · I21).
// Every state-changing request carries `X-CSRF-Token`, taken from /api/me or the login reply.
// No LLM is ever called from the browser: chat goes to the engine like everything else.

import { broadcast, DATA_CHANNEL } from '../lib/channels';

export const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let csrfToken: string | null = null;

export function setCsrf(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

export function getCsrf(): string | null {
  return csrfToken;
}

/** A refused request. `code` is the contract (`ErrorBody.code`) — the screen shows it in the
 * person's language (`api/errors.ts`); `message` is the server's English sentence, for the
 * console only, never for the screen (DESIGN.md `## 문구`). A body without a code (a proxy's
 * HTML page, an older server) has `code` null. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorParts(data: unknown): { code: string | null; params: Record<string, string | number> } {
  if (!data || typeof data !== 'object') return { code: null, params: {} };
  const body = data as { code?: unknown; params?: unknown };
  const code = typeof body.code === 'string' ? body.code : null;
  const params: Record<string, string | number> = {};
  if (body.params && typeof body.params === 'object') {
    for (const [k, v] of Object.entries(body.params as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') params[k] = v;
    }
  }
  return { code, params };
}

export interface RequestOptions {
  json?: unknown;
  body?: BodyInit;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function url(path: string, query?: RequestOptions['query']): string {
  const base = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (UNSAFE.has(method) && csrfToken) headers[CSRF_HEADER] = csrfToken;
  const res = await fetch(url(path, opts.query), {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: opts.signal,
  });
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : res.statusText;
    const { code, params } = errorParts(data);
    throw new ApiError(res.status, msg, code, params);
  }
  // something changed — another window showing this workspace (the office pop-out) asks again
  if (UNSAFE.has(method)) broadcast(DATA_CHANNEL, { type: 'refetch' });
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>('GET', path, { query }),
  post: <T>(path: string, json?: unknown, opts: RequestOptions = {}) => request<T>('POST', path, { ...opts, json }),
  put: <T>(path: string, json?: unknown) => request<T>('PUT', path, { json }),
  patch: <T>(path: string, json?: unknown) => request<T>('PATCH', path, { json }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: Blob, query: RequestOptions['query']) =>
    request<T>('POST', path, { body: file, query, headers: { 'Content-Type': 'application/octet-stream' } }),
};
