import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, CSRF_HEADER, setCsrf } from '../src/api/client';
import { PRESENCE_HEADER, PRESENT_FOR_MS, touched } from '../src/lib/presence';

function mockFetch(status = 200, body: unknown = { ok: true }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const headersOf = (fn: ReturnType<typeof mockFetch>, call = 0) => (fn.mock.calls[call][1]?.headers ?? {}) as Record<string, string>;

describe('api client (I21)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrf(null);
  });

  it('sends X-CSRF-Token on every state-changing request', async () => {
    const fetch = mockFetch();
    setCsrf('tok-123');
    await api.post('/threads', { title: 'x' });
    await api.put('/access', { allowed_networks: [] });
    await api.patch('/me', { locale: 'ko' });
    await api.del('/connections/a');
    await api.upload('/uploads', new Blob(['a']), { filename: 'x.csv' });
    expect(fetch).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) expect(headersOf(fetch, i)[CSRF_HEADER]).toBe('tok-123');
    expect(fetch.mock.calls[0][1]?.credentials).toBe('same-origin');
  });

  it('does not attach the token to reads', async () => {
    const fetch = mockFetch(200, []);
    setCsrf('tok-123');
    await api.get('/threads', { limit: 5 });
    expect(headersOf(fetch)[CSRF_HEADER]).toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe('/api/threads?limit=5');
  });

  it('turns an error body into ApiError with the status', async () => {
    mockFetch(409, { error: 'you would lose access' });
    await expect(api.put('/access', {})).rejects.toMatchObject({ status: 409, message: 'you would lose access' });
    await expect(api.put('/access', {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe('presence (자리를 비운 동안)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says X-Presence only while the person touched the page lately', async () => {
    const fetch = mockFetch();
    touched();
    await api.get('/me');
    expect(headersOf(fetch, 0)[PRESENCE_HEADER]).toBe('1');
    touched(Date.now() - PRESENT_FOR_MS - 1000); // a refetch in a tab nobody touched
    await api.get('/me');
    expect(headersOf(fetch, 1)[PRESENCE_HEADER]).toBeUndefined();
    touched();
  });
});
