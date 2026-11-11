import type { Env } from './env';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Equal strings, compared in time that does not depend on where they differ. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

/** The visitor's IP, salted and hashed — the raw IP is never stored. */
export async function ipHash(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return sha256(`${env.IP_SALT ?? 'solosquad-site'}:${ip}`);
}

/**
 * A fixed-window counter in D1: true while `bucket` has been hit at most `limit` times in the
 * current window of `windowSeconds`. Old windows are swept on the way.
 */
export async function withinLimit(db: D1Database, bucket: string, windowSeconds: number, limit: number, now = Date.now()): Promise<boolean> {
  const nowS = Math.floor(now / 1000);
  const start = nowS - (nowS % windowSeconds);
  const [row] = await db.batch<{ count: number }>([
    db
      .prepare('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count')
      .bind(bucket, start),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(nowS - 86_400),
  ]);
  return (row.results[0]?.count ?? 1) <= limit;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const iso = (ms = Date.now()) => new Date(ms).toISOString();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48 bits of time + 80 random bits, Crockford base32 — sorts by time, hard to guess. */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let tail = '';
  for (let i = 0; i < 16; i++) tail += CROCKFORD[rand[i] % 32];
  return time + tail;
}

/** The request body as JSON, or null when it is not JSON or larger than `max` bytes. */
export async function readJson(req: Request, max = 16_384): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > max) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
