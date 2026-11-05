// The one way the web talks to the engine — same origin, cookie session (PRD v2.1.0 I20 · I21).
// Every state-changing request carries `X-CSRF-Token`, taken from /api/me or the login reply.
// No LLM is ever called from the browser: chat goes to the engine like everything else.

export const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let csrfToken: string | null = null;

export function setCsrf(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

export function getCsrf(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
    throw new ApiError(res.status, msg);
  }
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
