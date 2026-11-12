// The demo login and session (2026-11-13 — the demo is a frontend-only copy on this site): a plain
// form {company_no, username, password} answered with a 303 (/demo/app with an HttpOnly signed
// cookie, or /demo?error=1 for every failure, the same way), the same-origin rule, the per-IP and
// per-ID limits, /api/demo/me, usage events (allow-listed, no IP or user-agent), logout, the
// /demo/app gate and the sweep.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { readSession, signSession, sweepDemo } from '../../src/demo';
import { DUMMY_HASH, hashPassword, newPassword, verifyPassword } from '../../scripts/lib/password.mjs';

const ORIGIN = 'https://marketing.test';
let n = 0;
const freshIp = () => `192.0.2.${++n}`;
const PASSWORD = 'Abcdefgh23456789';
const DAY = 86_400_000;

async function addAccount(id: string, over: { expires?: number; revoked?: boolean; companyNo?: string; name?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO demo_accounts (id, id_lower, inquiry_id, company_no, company_name, locale, password_hash, created_at, created_by, expires_at, revoked_at)
     VALUES (?1, ?2, 'INQ1', ?3, ?4, 'ko', ?5, ?6, 'test', ?7, ?8)`,
  )
    .bind(id, id.toLowerCase(), over.companyNo ?? '1234567890', over.name ?? '삼성전자', await hashPassword(PASSWORD, { iterations: 1000 }), new Date().toISOString(), new Date(over.expires ?? Date.now() + 14 * DAY).toISOString(), over.revoked ? new Date().toISOString() : null)
    .run();
}

const login = (fields: Record<string, string>, opts: { ip?: string; origin?: string | null } = {}) =>
  SELF.fetch(`${ORIGIN}/api/demo/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': opts.ip ?? freshIp(),
      ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
    },
    body: new URLSearchParams(fields).toString(),
  });

const cookieFrom = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

async function signedIn(id = 'samsungDemo') {
  const r = await login({ company_no: '123-45-67890', username: id, password: PASSWORD });
  expect(r.headers.get('location')).toBe(`${ORIGIN}/demo/app`);
  return cookieFrom(r);
}

beforeAll(async () => {
  await addAccount('samsungDemo');
  await addAccount('oldDemo', { expires: Date.now() - DAY });
  await addAccount('goneDemo', { revoked: true });
  await addAccount('hrbDemo', { companyNo: 'HRB-12345', name: 'Muster GmbH' });
});

describe('passwords (scripts/lib/password.mjs — the Worker and the CLI share it)', () => {
  it('PBKDF2-SHA256, per-account salt, 100 000 iterations by default (the Workers maximum)', async () => {
    const a = await hashPassword('secret-one');
    const b = await hashPassword('secret-one');
    expect(a).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('secret-one', a)).toBe(true);
    expect(await verifyPassword('secret-two', a)).toBe(false);
    expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('16 characters without look-alikes', () => {
    for (let i = 0; i < 20; i++) expect(newPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
  });
});

describe('POST /api/demo/login', () => {
  it('number + ID + password → 303 /demo/app with an HttpOnly, Secure, SameSite=Lax signed cookie; a login event', async () => {
    const r = await login({ company_no: '123-45-67890', username: 'SAMSUNGdemo', password: PASSWORD });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${ORIGIN}/demo/app`);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^ss_demo=[^;]+\.[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    const s = await readSession(env, cookieFrom(r).slice('ss_demo='.length));
    expect(s?.demo_id).toBe('samsungDemo');
    const ev = await env.DB.prepare("SELECT kind, detail FROM demo_events WHERE demo_id = 'samsungDemo' AND kind = 'login'").all();
    expect(ev.results.length).toBeGreaterThan(0);
  });

  it('another country’s number, any case and dashes', async () => {
    const r = await login({ company_no: 'hrb12345', username: 'hrbDemo', password: PASSWORD });
    expect(r.headers.get('location')).toBe(`${ORIGIN}/demo/app`);
  });

  it('every failure is the same 303 /demo?error=1 without a cookie: wrong password · number · unknown ID · expired · revoked · empty · cross-site', async () => {
    const tries: [Record<string, string>, string | null | undefined][] = [
      [{ company_no: '1234567890', username: 'samsungDemo', password: 'wrong-password!!' }, undefined],
      [{ company_no: '1111111111', username: 'samsungDemo', password: PASSWORD }, undefined],
      [{ company_no: '1234567890', username: 'nobodyDemo', password: PASSWORD }, undefined],
      [{ company_no: '1234567890', username: 'oldDemo', password: PASSWORD }, undefined],
      [{ company_no: '1234567890', username: 'goneDemo', password: PASSWORD }, undefined],
      [{ company_no: '', username: '', password: '' }, undefined],
      [{ company_no: '1234567890', username: 'samsungDemo', password: PASSWORD }, 'https://evil.example'],
      [{ company_no: '1234567890', username: 'samsungDemo', password: PASSWORD }, null],
    ];
    for (const [fields, origin] of tries) {
      const r = await login(fields, { origin });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`${ORIGIN}/demo?error=1`);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });

  it('10 a minute per IP (the router’s limit), counted whether they succeed or not', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await login({ company_no: '1', username: 'x', password: 'y' }, { ip });
    const r = await login({ company_no: '1234567890', username: 'samsungDemo', password: PASSWORD }, { ip });
    expect(r.headers.get('location')).toBe(`${ORIGIN}/demo?error=1`);
  });

  it('20 an hour per demo ID, from any IP', async () => {
    await addAccount('targetDemo');
    for (let i = 0; i < 20; i++) await login({ company_no: '1234567890', username: 'targetDemo', password: 'nope-nope-nope' });
    const r = await login({ company_no: '1234567890', username: 'targetDemo', password: PASSWORD });
    expect(r.headers.get('location')).toBe(`${ORIGIN}/demo?error=1`);
  });
});

describe('the session', () => {
  it('GET /api/demo/me: the account’s company name, locale and end — 401 without, with a forged or expired cookie', async () => {
    const cookie = await signedIn();
    const me = await SELF.fetch(`${ORIGIN}/api/demo/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ demo_id: 'samsungDemo', company_name: '삼성전자', locale: 'ko' });
    expect(Date.parse(String(body.expires))).toBeGreaterThan(Date.now());
    expect((await SELF.fetch(`${ORIGIN}/api/demo/me`)).status).toBe(401);
    const forged = await signSession({ ...env, DEMO_SECRET: 'other' }, { demo_id: 'samsungDemo', company_name: 'x', locale: 'ko', exp: Math.floor(Date.now() / 1000) + 600 });
    expect((await SELF.fetch(`${ORIGIN}/api/demo/me`, { headers: { cookie: `ss_demo=${forged}` } })).status).toBe(401);
    const stale = await signSession(env, { demo_id: 'samsungDemo', company_name: 'x', locale: 'ko', exp: Math.floor(Date.now() / 1000) - 1 });
    expect((await SELF.fetch(`${ORIGIN}/api/demo/me`, { headers: { cookie: `ss_demo=${stale}` } })).status).toBe(401);
  });

  it('a revoke ends a session at once (the cookie is checked against D1)', async () => {
    await addAccount('revokeDemo');
    const cookie = await signedIn('revokeDemo');
    expect((await SELF.fetch(`${ORIGIN}/api/demo/me`, { headers: { cookie } })).status).toBe(200);
    await env.DB.prepare("UPDATE demo_accounts SET revoked_at = ?1 WHERE id = 'revokeDemo'").bind(new Date().toISOString()).run();
    expect((await SELF.fetch(`${ORIGIN}/api/demo/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('POST /api/demo/event: view and action with a short detail; nothing else; same origin, signed in', async () => {
    const cookie = await signedIn();
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      SELF.fetch(`${ORIGIN}/api/demo/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie, ...headers }, body: JSON.stringify(body) });
    expect((await send({ kind: 'view', detail: '/o/moa/w/hq/office' })).status).toBe(200);
    expect((await send({ kind: 'action', detail: 'run:finance-monthly' })).status).toBe(200);
    for (const bad of [{ kind: 'login', detail: 'x' }, { kind: 'view', detail: '' }, { kind: 'view', detail: '<script>' }, { kind: 'view', detail: 'x'.repeat(81) }, { kind: 'action' }]) {
      expect((await send(bad)).status).toBe(400);
    }
    expect((await send({ kind: 'view', detail: '/x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send({ kind: 'view', detail: '/x' }, { cookie: '' })).status).toBe(401);
    const rows = await env.DB.prepare("SELECT * FROM demo_events WHERE demo_id = 'samsungDemo' AND kind IN ('view', 'action') ORDER BY at").all<Record<string, unknown>>();
    expect(rows.results.map((r) => [r.kind, r.detail])).toEqual([
      ['view', '/o/moa/w/hq/office'],
      ['action', 'run:finance-monthly'],
    ]);
    expect(Object.keys(rows.results[0]).sort()).toEqual(['at', 'demo_id', 'detail', 'kind']);
  });

  it('events are limited per account (30 a minute)', async () => {
    await addAccount('busyDemo');
    const cookie = await signedIn('busyDemo');
    const send = () => SELF.fetch(`${ORIGIN}/api/demo/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie }, body: JSON.stringify({ kind: 'view', detail: '/dashboard' }) });
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('POST /api/demo/logout forgets the cookie and records a logout', async () => {
    await addAccount('byeDemo');
    const cookie = await signedIn('byeDemo');
    const r = await SELF.fetch(`${ORIGIN}/api/demo/logout`, { method: 'POST', headers: { origin: ORIGIN, cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/^ss_demo=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
    const ev = await env.DB.prepare("SELECT kind FROM demo_events WHERE demo_id = 'byeDemo' ORDER BY at").all<{ kind: string }>();
    expect(ev.results.map((e) => e.kind)).toEqual(['login', 'logout']);
  });

  it('/demo/app and below: the demo login without a session; the page with one', async () => {
    for (const path of ['/demo/app', '/demo/app/dashboard', '/demo/app/o/moa/w/hq/office']) {
      const r = await SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`${ORIGIN}/demo`);
    }
    const cookie = await signedIn();
    const r = await SELF.fetch(`${ORIGIN}/demo/app/dashboard`, { redirect: 'manual', headers: { cookie } });
    expect(r.status).not.toBe(303);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the sweep', () => {
  it('drops events past the retention and accounts that ended that long ago, with their events', async () => {
    const long = new Date(Date.now() - 400 * DAY).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO demo_accounts (id, id_lower, company_no, company_name, password_hash, created_at, created_by, expires_at) VALUES ('ancientDemo', 'ancientdemo', '1234567890', 'x', ?1, ?2, 't', ?2)",
      ).bind(DUMMY_HASH, long),
      env.DB.prepare("INSERT INTO demo_events (demo_id, at, kind) VALUES ('ancientDemo', ?1, 'login')").bind(new Date().toISOString()),
      env.DB.prepare("INSERT INTO demo_events (demo_id, at, kind) VALUES ('samsungDemo', ?1, 'view')").bind(long),
    ]);
    await sweepDemo(env);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM demo_accounts WHERE id = 'ancientDemo'").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM demo_events WHERE demo_id = 'ancientDemo' OR at = ?1").bind(long).first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM demo_accounts WHERE id = 'samsungDemo'").first<{ n: number }>())!.n).toBe(1);
  });
});
