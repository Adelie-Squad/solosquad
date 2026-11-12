// The demo login and its session (2026-11-13). The demo is a frontend-only copy of the customer web
// served by this site at /demo/app — no demo server — so the accounts are D1 `demo_accounts` (made
// by `scripts/inquiry.mjs issue`) and this Worker signs people in:
//
//   POST /api/demo/login   a plain form {company_no, username, password} from /demo → 303 /demo/app
//                          with the session cookie, or 303 /demo?error=1 for every kind of failure
//                          (unknown ID · wrong password or number · expired · revoked · over the limit)
//   GET  /api/demo/me      {demo_id, company_name, locale, expires} or 401
//   POST /api/demo/event   one usage event {kind: view|action, detail} — rate-limited
//   POST /api/demo/logout  forgets the cookie
//
// The cookie is HMAC-signed (DEMO_SECRET) and HttpOnly, and it is checked against D1 on every use,
// so a revoke or an expiry ends a session at once. Usage events carry no IP, user-agent or text.
import { num, type Env } from './env';
import { hmac, ipHash, iso, json, sameSecret, sleep, withinLimit } from './http';
import { normalizeCompanyNo } from './validate';
import { DUMMY_HASH, verifyPassword } from '../scripts/lib/password.mjs';

export const COOKIE = 'ss_demo';
export const DEMO_LOGIN = '/demo';
export const DEMO_APP = '/demo/app';
const FAILED = `${DEMO_LOGIN}?error=1`;
/** The longest one sign-in lasts — the account's own end comes first when it is sooner. */
const SESSION_SECONDS = 12 * 3600;
const MAX_ID = 40;
export const EVENT_KINDS = ['view', 'action'] as const;
const DETAIL = /^[A-Za-z0-9_.:/-]{1,80}$/;

interface AccountRow {
  id: string;
  company_no: string;
  company_name: string;
  locale: string;
  password_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface DemoSession {
  demo_id: string;
  company_name: string;
  locale: string;
  /** the account's end (ISO) — the demo band shows it */
  expires: string;
}

const secret = (env: Env) => env.DEMO_SECRET ?? '';

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** `<payload b64url>.<hmac>` — payload {d: demo id, c: company name, l: locale, e: exp seconds}. */
export async function signSession(env: Env, s: { demo_id: string; company_name: string; locale: string; exp: number }): Promise<string> {
  const payload = b64(JSON.stringify({ d: s.demo_id, c: s.company_name, l: s.locale, e: s.exp }));
  return `${payload}.${await hmac(secret(env), `demo:${payload}`)}`;
}

export async function readSession(env: Env, token: string | null | undefined, now = Date.now()): Promise<{ demo_id: string; exp: number } | null> {
  if (!token || !secret(env)) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !(await sameSecret(mac, await hmac(secret(env), `demo:${payload}`)))) return null;
  try {
    const v = JSON.parse(unb64(payload)) as { d?: unknown; e?: unknown };
    if (typeof v.d !== 'string' || typeof v.e !== 'number' || v.e * 1000 <= now) return null;
    return { demo_id: v.d, exp: v.e };
  } catch {
    return null;
  }
}

const cookieOf = (req: Request, name: string) => {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
};

const setCookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const usable = (row: AccountRow | null, now: number): row is AccountRow => !!row && !row.revoked_at && Date.parse(row.expires_at) > now;

const account = (env: Env, id: string) =>
  env.DB.prepare('SELECT id, company_no, company_name, locale, password_hash, expires_at, revoked_at FROM demo_accounts WHERE id_lower = ?1').bind(id.toLowerCase()).first<AccountRow>();

/** The signed-in demo account, checked against D1 (revoked or expired → null). */
export async function currentDemo(req: Request, env: Env, now = Date.now()): Promise<DemoSession | null> {
  const s = await readSession(env, cookieOf(req, COOKIE), now);
  if (!s) return null;
  const row = await account(env, s.demo_id);
  if (!usable(row, now)) return null;
  return { demo_id: row.id, company_name: row.company_name, locale: row.locale, expires: row.expires_at };
}

/** A form post or fetch from this site — a cross-site page cannot sign someone in or post events. */
export const sameOrigin = (req: Request) => req.headers.get('origin') === new URL(req.url).origin;

export const record = (env: Env, demoId: string, kind: 'login' | 'logout' | 'view' | 'action', detail: string | null = null) =>
  env.DB.prepare('INSERT INTO demo_events (demo_id, at, kind, detail) VALUES (?1, ?2, ?3, ?4)').bind(demoId, iso(), kind, detail);

const seeOther = (path: string, url: URL, cookie?: string) => {
  const headers: Record<string, string> = { location: new URL(path, url).toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(null, { status: 303, headers });
};

async function loginFields(req: Request): Promise<{ company_no: string; username: string; password: string } | null> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return null;
  const body = await req.text();
  if (body.length > 2048) return null;
  const f = new URLSearchParams(body);
  return { company_no: f.get('company_no') ?? '', username: (f.get('username') ?? '').normalize('NFKC').trim(), password: f.get('password') ?? '' };
}

export async function postLogin(req: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const ip = await ipHash(req, env);
  const [perMin, perHour] = await Promise.all([
    withinLimit(env.DB, `demo-login-min:${ip}`, 60, num(env.ROUTE_LIMIT_PER_MIN, 10)),
    withinLimit(env.DB, `demo-login-hour:${ip}`, 3600, num(env.ROUTE_LIMIT_PER_HOUR, 60)),
  ]);
  const fields = sameOrigin(req) ? await loginFields(req) : null;
  const id = fields && fields.username.length <= MAX_ID ? fields.username : '';
  // a guessed ID is limited on its own too, whatever IP the guesses come from
  const perId = id ? await withinLimit(env.DB, `demo-login-id:${id.toLowerCase()}`, 3600, num(env.DEMO_LOGIN_LIMIT_PER_ID_HOUR, 20)) : true;
  const row = id ? await account(env, id) : null;
  // the hash is checked whatever came in, so every answer costs the same
  const passwordOk = await verifyPassword(fields?.password ?? '', row?.password_hash ?? DUMMY_HASH);
  const typedNo = normalizeCompanyNo(fields?.company_no ?? '');
  const numberOk = !!row && !!typedNo && (await sameSecret(typedNo.replace(/-/g, ''), row.company_no.replace(/-/g, '')));
  const now = Date.now();
  const ok = perMin && perHour && perId && !!secret(env) && passwordOk && numberOk && usable(row, now);
  let res: Response;
  if (ok && row) {
    const exp = Math.min(Math.floor(now / 1000) + SESSION_SECONDS, Math.floor(Date.parse(row.expires_at) / 1000));
    const token = await signSession(env, { demo_id: row.id, company_name: row.company_name, locale: row.locale, exp });
    await record(env, row.id, 'login').run();
    res = seeOther(DEMO_APP, url, setCookie(token, exp - Math.floor(now / 1000)));
  } else {
    if (!secret(env)) console.error('demo login: DEMO_SECRET is not set');
    res = seeOther(FAILED, url);
  }
  const left = num(env.ROUTE_PAD_MS, 250) - (Date.now() - started);
  if (left > 0) await sleep(left);
  return res;
}

export async function getMe(req: Request, env: Env): Promise<Response> {
  const me = await currentDemo(req, env);
  return me ? json(me) : json({ error: 'unauthorized' }, 401);
}

export async function postEvent(req: Request, env: Env): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
  const me = await currentDemo(req, env);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const text = await req.text();
  if (text.length > 512) return json({ error: 'bad_request' }, 400);
  let body: { kind?: unknown; detail?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const kind = (EVENT_KINDS as readonly unknown[]).includes(body.kind) ? (body.kind as (typeof EVENT_KINDS)[number]) : null;
  const detail = typeof body.detail === 'string' && DETAIL.test(body.detail) ? body.detail : null;
  if (!kind || !detail) return json({ error: 'bad_request' }, 400);
  const id = me.demo_id.toLowerCase();
  const [perMin, perHour] = await Promise.all([
    withinLimit(env.DB, `demo-event-min:${id}`, 60, num(env.DEMO_EVENT_LIMIT_PER_MIN, 30)),
    withinLimit(env.DB, `demo-event-hour:${id}`, 3600, num(env.DEMO_EVENT_LIMIT_PER_HOUR, 300)),
  ]);
  if (!perMin || !perHour) return json({ error: 'rate_limited' }, 429);
  await record(env, me.demo_id, kind, detail).run();
  return json({ ok: true });
}

export async function postLogout(req: Request, env: Env): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const me = await currentDemo(req, env);
  if (me) await record(env, me.demo_id, 'logout').run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
}

/** The demo app's pages: only with a session — else the demo login. */
export async function demoPage(req: Request, env: Env): Promise<Response> {
  if (!(await currentDemo(req, env))) return seeOther(DEMO_LOGIN, new URL(req.url));
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-store');
  return out;
}

/** The daily sweep's demo part: events past the retention, and accounts that ended that long ago (with their events). */
export async function sweepDemo(env: Env, now = Date.now()): Promise<void> {
  const cut = iso(now - num(env.RETAIN_DAYS, 365) * 86_400_000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM demo_events WHERE at < ?1').bind(cut),
    env.DB.prepare('DELETE FROM demo_events WHERE demo_id IN (SELECT id FROM demo_accounts WHERE coalesce(revoked_at, expires_at) < ?1)').bind(cut),
    env.DB.prepare('DELETE FROM demo_accounts WHERE coalesce(revoked_at, expires_at) < ?1').bind(cut),
  ]);
}
