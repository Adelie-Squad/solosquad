// The demo account request (PRD §3.6.3 · C57): validation, the D1 row + its "created" log, the
// honeypot, the 3-second rule, the per-IP and per-email limits (nothing stored for any of them),
// no IP or user-agent with the row, the retention sweep, and the config the pages read.
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { checkFormToken, formToken, sweep } from '../../src/inquiry';
import { validateInquiry } from '../../src/validate';
import { verifyPassword } from '../../scripts/lib/password.mjs';

let n = 0;
const freshIp = () => `203.0.113.${++n}`;
let mail = 0;
const freshEmail = () => `person${++mail}@example.com`;

const post = (body: unknown, ip = freshIp(), headers: Record<string, string> = {}) =>
  SELF.fetch('https://marketing.test/api/inquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const opened = (msAgo = 5000) => formToken(env, Date.now() - msAgo);

async function request(over: Record<string, unknown> = {}) {
  return {
    company: '에이스상사',
    company_no: '123-45-67891',
    company_no_kind: 'business',
    business_type: 'retail',
    country: 'kr',
    contact_name: '김민지',
    email: freshEmail(),
    phone: '010-1234-5678',
    reach_kind: 'kakao',
    reach_value: 'minji-kakao',
    wants: ['finance', 'sns'],
    requests: ['demo'],
    message: '엑셀로 손익을 정리하고 있어요.',
    consent_required: true,
    consent_demo: true,
    consent_news: false,
    locale: 'ko',
    source: 'demo_login',
    website: '',
    form_token: await opened(),
    ...over,
  };
}

const count = async (table = 'inquiries') => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('validation (the modal checks the same)', () => {
  it('names every field that is missing, too long or not one of the choices', () => {
    const r = validateInquiry({ company: 'x'.repeat(81), business_type: 'bank', email: 'nope', wants: ['crypto'], requests: [], consent_required: false, locale: 'fr', source: 'ads' });
    expect(!r.ok && r.fields).toEqual({
      company: 'too_long',
      company_no: 'required',
      contact_name: 'required',
      email: 'invalid',
      business_type: 'invalid',
      country: 'required',
      wants: 'invalid',
      requests: 'required',
      consent_required: 'required',
      locale: 'invalid',
      source: 'invalid',
    });
  });

  it('asking for a demo account needs the demo-usage consent and a phone too (DM6 ⓑ · the password); a call alone does not', () => {
    const base = { company: 'Acme', company_no: '91350100M000100Y43', business_type: 'online', country: 'cn', contact_name: 'Li', email: 'LI@ACME.CN', wants: ['sourcing'], consent_required: true, locale: 'zh-CN', source: 'pricing' };
    expect(validateInquiry({ ...base, requests: ['demo'] })).toEqual({ ok: false, fields: { consent_demo: 'required', phone: 'required' } });
    const call = validateInquiry({ ...base, requests: ['consult'] });
    expect(call.ok && call.value).toMatchObject({ email: 'li@acme.cn', company_no: '91350100M000100Y43', company_no_kind: 'uscc', phone: null, requests: ['consult'], consent_demo: false });
    const demo = validateInquiry({ ...base, requests: ['demo'], consent_demo: true, phone: '+86 138 0013 8000' });
    expect(demo.ok && demo.value).toMatchObject({ phone: '13800138000' }); // +86 taken off (2026-11-14)
  });

  it('the phone: digits stored; a Korean one by the Korean rules; anything but digits and separators refused', () => {
    const base = { company: 'Acme', company_no: '1234567891', company_no_kind: 'business', business_type: 'online', country: 'kr', contact_name: 'Li', email: 'li@acme.kr', wants: ['sourcing'], requests: ['consult'], consent_required: true, locale: 'ko', source: 'pricing' };
    const stored = (phone: unknown, country = 'kr') => {
      const r = validateInquiry({ ...base, phone, country, ...(country === 'cn' ? { company_no: '91350100M000100Y43' } : {}) });
      return r.ok ? r.value.phone : r.fields.phone;
    };
    expect(stored('010-1234-5678')).toBe('01012345678');
    expect(stored('02 123 4567')).toBe('021234567');
    expect(stored('010-12')).toBe('invalid');
    expect(stored('010-abcd-5678')).toBe('invalid');
    expect(stored('')).toBeNull();
    expect(stored('4915112345678', 'other')).toBe('4915112345678');
    // China: an 11-digit mobile from 1, +86 / 0086 taken off
    expect(stored('+86 138-0013-8000', 'cn')).toBe('13800138000');
    expect(stored('138 0013 8000', 'cn')).toBe('13800138000');
    expect(stored('0571-8888-8888', 'cn')).toBe('invalid');
  });

  it('the company registration number: digits only, with its kind; a Korean one by its check digit; another country’s 4–20 digits', () => {
    const base = { company: 'Acme', business_type: 'online', contact_name: 'Li', email: 'li@acme.cn', wants: ['sourcing'], requests: ['consult'], consent_required: true, locale: 'ko', source: 'pricing' };
    const stored = (company_no: unknown, country: string, company_no_kind?: string) => {
      const r = validateInquiry({ ...base, company_no, country, company_no_kind });
      return r.ok ? `${r.value.company_no}/${r.value.company_no_kind}` : (r.fields.company_no ?? r.fields.company_no_kind);
    };
    expect(stored('123-45-67891', 'kr', 'business')).toBe('1234567891/business'); // 사업자등록번호
    expect(stored(' 123 45 67891 ', 'kr', 'business')).toBe('1234567891/business');
    expect(stored('110111-1234569', 'kr', 'corporate')).toBe('1101111234569/corporate'); // 법인등록번호
    expect(stored('１２３４５６７８９１', 'kr', 'business')).toBe('1234567891/business'); // full-width digits
    expect(stored('1101111234569', 'kr')).toBe('1101111234569/corporate'); // an older page: no kind → by length
    expect(stored('123-45-67890', 'kr', 'business')).toBe('invalid'); // the check digit
    expect(stored('110111-1234569', 'kr', 'business')).toBe('invalid'); // 13 digits for a 사업자등록번호
    expect(stored('123-45-6789', 'kr', 'business')).toBe('invalid');
    expect(stored('1234567891', 'kr', 'sole')).toBe('invalid');
    expect(stored('HRB-12345', 'other')).toBe('HRB12345/foreign'); // letters and digits (2026-11-14)
    expect(stored('HRB/12345', 'other')).toBe('invalid');
    expect(stored('12345', 'other')).toBe('12345/foreign');
    expect(stored('123-45-67890', 'other', 'business')).toBe('1234567890/foreign'); // no check digit for another country
    // China (2026-11-14): the 统一社会信用代码, 18 with its check character, upper-cased
    expect(stored('91350100m000100y43', 'cn', 'business')).toBe('91350100M000100Y43/uscc');
    expect(stored('91350100M000100Y44', 'cn')).toBe('invalid');
    expect(stored('1234567891', 'cn')).toBe('invalid');
    expect(stored('123', 'other')).toBe('invalid');
    expect(stored('1'.repeat(21), 'other')).toBe('invalid');
    expect(stored('   ', 'kr', 'business')).toBe('required');
    expect(stored(12345678, 'other')).toBe('required');
  });
});

describe('POST /api/inquiry', () => {
  it('stores one row (status new, consent, version, locale, source, requests, opened_at, retain_until) and one created log', async () => {
    const [before, logs] = [await count(), await count('inquiry_log')];
    const body = await request({ requests: ['consult'] });
    const r = await post(body, freshIp(), { 'user-agent': 'secret-agent/1.0' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await count()).toBe(before + 1);
    expect(await count('inquiry_log')).toBe(logs + 1);
    const row = await env.DB.prepare('SELECT * FROM inquiries WHERE email = ?1').bind(body.email).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      company: '에이스상사',
      company_no: '1234567891',
      company_no_kind: 'business',
      phone: '01012345678',
      business_type: 'retail',
      country: 'kr',
      contact_name: '김민지',
      reach_kind: 'kakao',
      reach_value: 'minji-kakao',
      wants: '["finance","sns"]',
      requests: '["consult"]',
      consent_required: 1,
      consent_demo: 0,
      consent_version: env.CONSENT_VERSION,
      consent_news: 0,
      locale: 'ko',
      source: 'demo_login',
      status: 'new',
      demo_id: null,
      demo_account: null,
    });
    expect(String(row!.id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(Date.parse(String(row!.retain_until)) - Date.parse(String(row!.created_at))).toBe(365 * 86_400_000);
    expect(Date.parse(String(row!.opened_at))).toBeLessThan(Date.parse(String(row!.created_at)));
    // neither the IP nor the user-agent is kept with it
    expect(JSON.stringify(row)).not.toMatch(/203\.0\.113|secret-agent/);
    const log = await env.DB.prepare('SELECT actor, action, detail FROM inquiry_log WHERE inquiry_id = ?1').bind(row!.id).all();
    expect(log.results).toEqual([{ actor: 'system', action: 'created', detail: '{"source":"demo_login","requests":["consult"]}' }]);
  });

  it('refuses an invalid request with the fields, and stores nothing', async () => {
    const before = await count();
    const r = await post(await request({ email: 'nope', consent_required: false }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid', fields: { email: 'invalid', consent_required: 'required' } });
    expect(await count()).toBe(before);
  });

  it('honeypot: answered like a person, nothing stored', async () => {
    const before = [await count(), await count('inquiry_log')];
    const r = await post(await request({ website: 'https://spam.example' }));
    expect(await r.json()).toEqual({ ok: true });
    expect([await count(), await count('inquiry_log')]).toEqual(before);
  });

  it('the 3-second rule: too soon, forged or missing tokens are refused and nothing is stored', async () => {
    const before = await count();
    expect(await (await post(await request({ form_token: await opened(500) }))).json()).toEqual({ error: 'too_fast' });
    expect(await (await post(await request({ form_token: `${Date.now() - 10_000}.forged` }))).json()).toEqual({ error: 'expired' });
    expect(await (await post(await request({ form_token: undefined }))).json()).toEqual({ error: 'expired' });
    expect(await count()).toBe(before);
    expect(await checkFormToken(env, await opened(25 * 3600 * 1000))).toEqual({ ok: false, error: 'expired' });
  });

  it('the form token comes from GET /api/form-token', async () => {
    const { token } = (await (await SELF.fetch('https://marketing.test/api/form-token')).json()) as { token: string };
    expect(await checkFormToken(env, token)).toEqual({ ok: false, error: 'too_fast' });
    expect((await checkFormToken(env, token, Date.now() + 4000)).ok).toBe(true);
  });

  it('per IP: the 6th in an hour is refused; per email: the 4th in a day is refused — nothing stored', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await post(await request(), ip)).status).toBe(200);
    const before = await count();
    expect((await post(await request(), ip)).status).toBe(429);
    const email = freshEmail();
    for (let i = 0; i < 3; i++) expect((await post(await request({ email }))).status).toBe(200);
    const fourth = await post(await request({ email: email.toUpperCase() }));
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'rate_limited' });
    expect(await count()).toBe(before + 3);
  });

  it('JSON only — a cross-site form post never reaches the handler', async () => {
    const form = await SELF.fetch('https://marketing.test/api/inquiry', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'company=x' });
    expect(form.status).toBe(415);
    expect((await post('{not json')).status).toBe(400);
  });

  it('there is no admin HTTP API and no old paths', async () => {
    for (const path of ['/api/admin/inquiries', '/api/inquiries', '/api/login/lookup']) {
      expect((await SELF.fetch(`https://marketing.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    }
  });
});

describe('the demo account, issued on the request (2026-11-13 — no review)', () => {
  type Answer = { ok: true; demo?: { id: string; password: string; company_no: string; company_no_kind: string; company_name: string; expires: string; reused: boolean } };
  const account = (id: string) => env.DB.prepare('SELECT * FROM demo_accounts WHERE id_lower = ?1').bind(id.toLowerCase()).first<Record<string, unknown>>();
  const signIn = (company_no: string, username: string, password: string) =>
    SELF.fetch('https://marketing.test/api/demo/login', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://marketing.test', 'cf-connecting-ip': freshIp() },
      body: new URLSearchParams({ company_no, username, password }).toString(),
    });

  it('ID = the email, password = word + the phone’s last four, 14 days; only the hash is stored; the account signs in', async () => {
    const r = await post(await request({ email: 'Abc123@Example.com', phone: '010-9876-5432' }));
    const out = (await r.json()) as Answer;
    expect(out.ok).toBe(true);
    expect(out.demo).toMatchObject({ id: 'abc123@example.com', password: 'apple5432', company_no: '1234567891', company_no_kind: 'business', company_name: '에이스상사', reused: false });
    const days = (Date.parse(out.demo!.expires) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const row = await account('abc123@example.com');
    expect(row).toMatchObject({ id: 'abc123@example.com', company_no: '1234567891', company_no_kind: 'business', created_by: 'system', internal: 0, revoked_at: null, expires_at: out.demo!.expires });
    expect(await verifyPassword('apple5432', String(row!.password_hash))).toBe(true);
    expect(JSON.stringify(row)).not.toContain('apple5432');
    const inquiry = await env.DB.prepare('SELECT * FROM inquiries WHERE email = ?1').bind('abc123@example.com').first<Record<string, unknown>>();
    expect(inquiry).toMatchObject({ status: 'issued', demo_account: 'abc123@example.com', demo_expires_at: out.demo!.expires, demo_id: null });
    expect(JSON.stringify(inquiry)).not.toContain('apple5432');
    const log = await env.DB.prepare('SELECT action, detail FROM inquiry_log WHERE inquiry_id = ?1 ORDER BY ts, action').bind(inquiry!.id).all<{ action: string; detail: string }>();
    expect(log.results.map((l) => l.action)).toEqual(['created', 'issued']);
    expect(log.results[1].detail).not.toContain('abc123');
    // the demo login: the number with or without hyphens, the email in any case
    const login = await signIn('123-45-67891', 'ABC123@example.COM', 'apple5432');
    expect(login.headers.get('location')).toBe('https://marketing.test/demo/app');
  });

  it('a Chinese company (2026-11-14): its 统一社会信用代码 and mobile; the account signs in with the code, letters in any case', async () => {
    const r = await post(await request({ country: 'cn', company_no: '91350100m000100y43', company_no_kind: undefined, phone: '+86 138 0013 8000', email: 'Li.Wei@example.cn', locale: 'zh-CN', reach_kind: 'wechat' }));
    const out = (await r.json()) as Answer;
    expect(out.demo).toMatchObject({ id: 'li.wei@example.cn', password: 'lemon8000', company_no: '91350100M000100Y43', company_no_kind: 'uscc' });
    expect(await account('li.wei@example.cn')).toMatchObject({ company_no: '91350100M000100Y43', company_no_kind: 'uscc', locale: 'zh-CN' });
    const row = await env.DB.prepare('SELECT country, phone, company_no, company_no_kind FROM inquiries WHERE email = ?1').bind('li.wei@example.cn').first();
    expect(row).toEqual({ country: 'cn', phone: '13800138000', company_no: '91350100M000100Y43', company_no_kind: 'uscc' });
    expect((await signIn('91350100m000100y43', 'li.wei@example.cn', 'lemon8000')).headers.get('location')).toBe('https://marketing.test/demo/app');
    expect((await signIn('913501000001004', 'li.wei@example.cn', 'lemon8000')).headers.get('location')).toBe('https://marketing.test/demo?error=1');
  });

  it('the same email again: the same account — a fresh password from the new phone, the new number, a later end — linked to the new request', async () => {
    const email = 'penguin.fan@example.com';
    const first = ((await (await post(await request({ email, phone: '010-1111-2222' }))).json()) as Answer).demo!;
    await env.DB.prepare('UPDATE demo_accounts SET expires_at = ?1 WHERE id = ?2').bind(new Date(Date.now() + 86_400_000).toISOString(), email).run();
    const again = await post(await request({ email: email.toUpperCase(), phone: '010-3333-4444', company_no: '110111-1234569', company_no_kind: 'corporate' }));
    const second = ((await again.json()) as Answer).demo!;
    expect(first.password).toBe('penguin2222');
    expect(second).toMatchObject({ id: email, password: 'penguin4444', company_no: '1101111234569', company_no_kind: 'corporate', reused: true });
    expect(Date.parse(second.expires)).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM demo_accounts WHERE id_lower = ?1').bind(email).first<{ n: number }>())!.n).toBe(1);
    const linked = await env.DB.prepare('SELECT id, status, demo_account FROM inquiries WHERE email = ?1 ORDER BY created_at').bind(email).all<Record<string, unknown>>();
    expect(linked.results.map((q) => [q.status, q.demo_account])).toEqual([
      ['issued', email],
      ['issued', email],
    ]);
    expect((await account(email))!.inquiry_id).toBe(linked.results[1].id);
    expect((await signIn('1101111234569', email, 'penguin2222')).headers.get('location')).toBe('https://marketing.test/demo?error=1');
    expect((await signIn('110111-1234569', email, 'penguin4444')).headers.get('location')).toBe('https://marketing.test/demo/app');
  });

  it('a later request never shortens the end', async () => {
    const email = 'long@example.com';
    await post(await request({ email }));
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE demo_accounts SET expires_at = ?1 WHERE id = ?2').bind(far, email).run();
    const again = ((await (await post(await request({ email }))).json()) as Answer).demo!;
    expect(again.expires).toBe(far);
  });

  it('a call only: no account', async () => {
    const body = await request({ requests: ['consult'], consent_demo: false });
    expect(await (await post(body)).json()).toEqual({ ok: true });
    expect(await account(body.email as string)).toBeNull();
  });

  it('a revoked account or an internal one is never issued again from a request — the request is kept for the agency', async () => {
    const email = 'gone@example.com';
    await post(await request({ email }));
    await env.DB.prepare('UPDATE demo_accounts SET revoked_at = ?1 WHERE id = ?2').bind(new Date().toISOString(), email).run();
    expect(await (await post(await request({ email, phone: '010-5555-6666' }))).json()).toEqual({ ok: true });
    expect((await account(email))!.revoked_at).not.toBeNull();
    expect(await verifyPassword('grape6666', String((await account(email))!.password_hash))).toBe(false);
    const last = await env.DB.prepare("SELECT status, demo_account FROM inquiries WHERE email = ?1 ORDER BY created_at DESC LIMIT 1").bind(email).first();
    expect(last).toEqual({ status: 'new', demo_account: null });

    await env.DB.prepare(
      "INSERT INTO demo_accounts (id, id_lower, company_no, company_name, password_hash, created_at, created_by, expires_at, internal) VALUES ('owner@example.com', 'owner@example.com', '0000000000', 'SoloSquad', 'x', ?1, 'agency', NULL, 1)",
    ).bind(new Date().toISOString()).run();
    expect(await (await post(await request({ email: 'owner@example.com' }))).json()).toEqual({ ok: true });
    expect(await account('owner@example.com')).toMatchObject({ password_hash: 'x', internal: 1, expires_at: null });
  });

  it('one IP gets at most 3 new accounts a day (a repeat for the same email does not count); past that the request is kept without one', async () => {
    const ip = freshIp();
    const emails = ['one@cap.example', 'two@cap.example', 'three@cap.example'];
    for (const email of emails) expect(((await (await post(await request({ email }), ip)).json()) as Answer).demo?.id).toBe(email);
    expect(((await (await post(await request({ email: emails[0] }), ip)).json()) as Answer).demo?.reused).toBe(true);
    const fourth = await post(await request({ email: 'four@cap.example' }), ip);
    expect(fourth.status).toBe(200);
    expect(await fourth.json()).toEqual({ ok: true });
    expect(await account('four@cap.example')).toBeNull();
    expect(await env.DB.prepare('SELECT status FROM inquiries WHERE email = ?1').bind('four@cap.example').first()).toEqual({ status: 'new' });
    // and the hourly request limit still stops the sixth request of the hour from that IP
    expect((await post(await request(), ip)).status).toBe(429);
  });
});

describe('retention (the daily cron trigger)', () => {
  it('deletes inquiries past retain_until with their log, keeps the rest', async () => {
    const body = await request();
    await post(body);
    const row = await env.DB.prepare('SELECT id FROM inquiries WHERE email = ?1').bind(body.email).first<{ id: string }>();
    await env.DB.prepare("UPDATE inquiries SET retain_until = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(row!.id).run();
    const before = await count();
    expect(await sweep(env)).toBe(1);
    expect(await count()).toBe(before - 1);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM inquiry_log WHERE inquiry_id = ?1').bind(row!.id).first<{ n: number }>())!.n).toBe(0);
  });

  it('the scheduled handler runs the sweep', async () => {
    const ctx = createExecutionContext();
    await worker.scheduled!({ cron: '17 3 * * *', scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
  });
});

describe('GET /api/config', () => {
  it('the consent version; Turnstile off by default; no secrets', async () => {
    const cfg = (await (await SELF.fetch('https://marketing.test/api/config')).json()) as Record<string, unknown>;
    expect(cfg).toEqual({ consent_version: env.CONSENT_VERSION, turnstile: { enabled: false, site_key: '' } });
    expect(JSON.stringify(cfg)).not.toContain('test-form-secret');
    expect(JSON.stringify(cfg)).not.toContain('test-demo-secret');
  });
});
