// The demo login and its session (2026-11-13). The demo is a frontend-only copy of the customer web
// served by this site at /demo/app — no demo server — so the accounts are D1 `demo_accounts` (made
// on the request itself — `issueDemo` below — or by `scripts/inquiry.mjs issue · demo create`) and
// this Worker signs people in. The ID is the request's email or an internal id like `solosquad`;
// the number is compared as its normalised code (letters and digits, upper case — China's 统一社会信用代码
// has letters; a row from before 2026-11-13 by its digits):
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
import type { Inquiry } from './validate';
import { codeOf, digitsOf, FOREIGN_MIN } from '../scripts/lib/company-no.mjs';
import { demoPassword } from '../scripts/lib/demo-password.mjs';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../scripts/lib/password.mjs';

export const COOKIE = 'ss_demo';
export const DEMO_LOGIN = '/demo';
export const DEMO_APP = '/demo/app';
const FAILED = `${DEMO_LOGIN}?error=1`;
/** The longest one sign-in lasts — the account's own end comes first when it is sooner. */
const SESSION_SECONDS = 12 * 3600;
/** an email is the longest ID */
const MAX_ID = 254;
const DAY = 86_400_000;
export const EVENT_KINDS = ['view', 'action'] as const;
const DETAIL = /^[A-Za-z0-9_.:/-]{1,80}$/;
/**
 * The workflow events the KPI counts (2026-11-14 — "logged-in demo accounts that ran a workflow to
 * the end"): the demo app sends `workflow_started:<id>` when a run starts and, once per run,
 * `workflow_done:<id>:<approved|declined>` when it ends (web/src/demo/engine.ts). Only these are
 * taken under the `workflow_` prefix, as `action`s, so the count cannot be padded with made-up names.
 */
export const WORKFLOW_IDS = ['finance', 'sourcing', 'sns'] as const;
const WORKFLOW_EVENT = new RegExp(`^workflow_(?:started:(?:${WORKFLOW_IDS.join('|')})|done:(?:${WORKFLOW_IDS.join('|')}):(?:approved|declined))$`);

/** Whether a usage event's detail may be stored: the shape for all, the allow-list for `workflow_…`. */
export function eventDetailOk(kind: string, detail: string): boolean {
  if (!DETAIL.test(detail)) return false;
  if (!detail.startsWith('workflow_')) return true;
  return kind === 'action' && WORKFLOW_EVENT.test(detail);
}

interface AccountRow {
  id: string;
  company_no: string;
  /** business · corporate · uscc · foreign; NULL on rows from before 2026-11-13 */
  company_no_kind: string | null;
  company_name: string;
  locale: string;
  password_hash: string;
  /** null = no end (internal accounts) */
  expires_at: string | null;
  revoked_at: string | null;
}

export interface DemoSession {
  demo_id: string;
  company_name: string;
  locale: string;
  /** the account's end (ISO) — the demo band shows it; null = no end */
  expires: string | null;
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

const usable = (row: AccountRow | null, now: number): row is AccountRow => !!row && !row.revoked_at && (row.expires_at === null || Date.parse(row.expires_at) > now);

const account = (env: Env, id: string) =>
  env.DB.prepare('SELECT id, company_no, company_no_kind, company_name, locale, password_hash, expires_at, revoked_at FROM demo_accounts WHERE id_lower = ?1').bind(id.toLowerCase()).first<AccountRow>();

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
  // the normalised codes (letters and digits, upper case — the field shows hyphens; China's code has
  // letters); a row from before 2026-11-13 (no kind) is matched by its digits, as it always was
  const legacy = !!row && row.company_no_kind === null;
  const typedNo = legacy ? digitsOf(fields?.company_no ?? '') : codeOf(fields?.company_no ?? '');
  const storedNo = row ? (legacy ? digitsOf(row.company_no) : codeOf(row.company_no)) : '';
  const numberOk = !!row && typedNo.length >= FOREIGN_MIN && (await sameSecret(typedNo, storedNo));
  const now = Date.now();
  const ok = perMin && perHour && perId && !!secret(env) && passwordOk && numberOk && usable(row, now);
  let res: Response;
  if (ok && row) {
    const longest = Math.floor(now / 1000) + SESSION_SECONDS;
    const exp = row.expires_at === null ? longest : Math.min(longest, Math.floor(Date.parse(row.expires_at) / 1000));
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
  const detail = kind && typeof body.detail === 'string' && eventDetailOk(kind, body.detail) ? body.detail : null;
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

/** What the request's sender sees once, on the completion screen — the only place the password is plain. */
export interface IssuedDemo {
  id: string;
  password: string;
  company_no: string;
  company_no_kind: Inquiry['company_no_kind'];
  company_name: string;
  expires: string;
  /** a later request from the same email: the same account, a fresh password and end */
  reused: boolean;
}

/**
 * The demo account for a request that asks for one (2026-11-13 — issued at once, no review): the
 * ID is the email, the password `demoPassword(email, phone)`, the end DEMO_DAYS (14) from now. The
 * same email again keeps its account — the password follows the new phone, the number, company and
 * language follow the new request, and the end moves out (never in). Nothing is issued (null) for
 * an account the agency revoked or made itself (`internal`), or when this IP has already had
 * DEMO_ISSUE_LIMIT_PER_IP_DAY (3) new accounts today — the request is still kept for the agency.
 */
export async function issueDemo(env: Env, v: Inquiry, inquiryId: string, ip: string, now = Date.now()): Promise<IssuedDemo | null> {
  const id = v.email.toLowerCase();
  const password = v.phone ? demoPassword(id, v.phone) : null;
  if (!password || id.length > MAX_ID) return null;
  const known = await env.DB.prepare('SELECT revoked_at, internal FROM demo_accounts WHERE id_lower = ?1').bind(id).first<{ revoked_at: string | null; internal: number }>();
  if (known && (known.revoked_at || known.internal)) return null;
  if (!known && !(await withinLimit(env.DB, `demo-issue:${ip}`, 86_400, num(env.DEMO_ISSUE_LIMIT_PER_IP_DAY, 3), now))) return null;

  const at = iso(now);
  const days = num(env.DEMO_DAYS, 14);
  const hash = await hashPassword(password);
  const [account] = await env.DB.batch<{ expires_at: string }>([
    env.DB.prepare(
      `INSERT INTO demo_accounts (id, id_lower, inquiry_id, company_no, company_no_kind, company_name, locale, password_hash, created_at, created_by, updated_at, expires_at, internal)
       VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'system', ?8, ?9, 0)
       ON CONFLICT (id_lower) DO UPDATE SET inquiry_id = excluded.inquiry_id, company_no = excluded.company_no, company_no_kind = excluded.company_no_kind,
         company_name = excluded.company_name, locale = excluded.locale, password_hash = excluded.password_hash, updated_at = excluded.updated_at,
         expires_at = max(coalesce(demo_accounts.expires_at, ''), excluded.expires_at)
       WHERE demo_accounts.revoked_at IS NULL AND demo_accounts.internal = 0
       RETURNING expires_at`,
    ).bind(id, inquiryId, v.company_no, v.company_no_kind, v.company, v.locale, hash, at, iso(now + days * DAY)),
  ]);
  const expires = account.results[0]?.expires_at;
  if (!expires) return null;
  await env.DB.batch([
    env.DB.prepare("UPDATE inquiries SET status = 'issued', demo_account = ?1, demo_issued_at = ?2, demo_expires_at = ?3, updated_at = ?2 WHERE id = ?4").bind(id, at, expires, inquiryId),
    // no personal data in the log — the ID is the email, so it is not written here
    env.DB.prepare("INSERT INTO inquiry_log (inquiry_id, ts, actor, action, detail) VALUES (?1, ?2, 'system', 'issued', ?3)").bind(inquiryId, at, JSON.stringify({ auto: true, reused: !!known, days })),
  ]);
  return { id, password, company_no: v.company_no, company_no_kind: v.company_no_kind, company_name: v.company, expires, reused: !!known };
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
