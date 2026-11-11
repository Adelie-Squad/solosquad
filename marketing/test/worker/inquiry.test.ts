// The demo account request (PRD §3.6.3 · C57): validation, the D1 row + its "created" log, the
// honeypot, the 3-second rule, the per-IP and per-email limits (nothing stored for any of them),
// no IP or user-agent with the row, the retention sweep, and the config the pages read.
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { checkFormToken, formToken, sweep } from '../../src/inquiry';
import { validateInquiry } from '../../src/validate';

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
    company_no: '123-45-67890',
    business_type: 'retail',
    country: 'kr',
    contact_name: '김민지',
    email: freshEmail(),
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

  it('asking for a demo account needs the demo-usage consent too (DM6 ⓑ); a call alone does not', () => {
    const base = { company: 'Acme', company_no: '91310000-ma1fl', business_type: 'online', country: 'cn', contact_name: 'Li', email: 'LI@ACME.CN', wants: ['sourcing'], consent_required: true, locale: 'zh-CN', source: 'pricing' };
    expect(validateInquiry({ ...base, requests: ['demo'] })).toEqual({ ok: false, fields: { consent_demo: 'required' } });
    const call = validateInquiry({ ...base, requests: ['consult'] });
    expect(call.ok && call.value).toMatchObject({ email: 'li@acme.cn', company_no: '91310000-MA1FL', requests: ['consult'], consent_demo: false });
  });

  it('the company registration number: a Korean one (10 or 13 digits) stored as digits, another country’s 4–30 letters, digits and dashes', () => {
    const base = { company: 'Acme', business_type: 'online', contact_name: 'Li', email: 'li@acme.cn', wants: ['sourcing'], requests: ['consult'], consent_required: true, locale: 'ko', source: 'pricing' };
    const stored = (company_no: unknown, country: string) => {
      const r = validateInquiry({ ...base, company_no, country });
      return r.ok ? r.value.company_no : r.fields.company_no;
    };
    expect(stored('123-45-67890', 'kr')).toBe('1234567890'); // 사업자등록번호
    expect(stored(' 123 45 67890 ', 'kr')).toBe('1234567890');
    expect(stored('110111-1234567', 'kr')).toBe('1101111234567'); // 법인등록번호
    expect(stored('１２３４５６７８９０', 'kr')).toBe('1234567890'); // full-width digits
    expect(stored('123-45-6789', 'kr')).toBe('invalid'); // a Korean company gives one of the Korean two
    expect(stored('HRB-12345', 'kr')).toBe('invalid');
    expect(stored('hrb-12345', 'other')).toBe('HRB-12345');
    expect(stored('123-45-67890', 'cn')).toBe('1234567890');
    expect(stored('abc', 'other')).toBe('invalid');
    expect(stored('x'.repeat(31), 'other')).toBe('invalid');
    expect(stored('12_34', 'other')).toBe('invalid');
    expect(stored('   ', 'kr')).toBe('required');
    expect(stored(12345678, 'other')).toBe('required');
  });
});

describe('POST /api/inquiry', () => {
  it('stores one row (status new, consent, version, locale, source, requests, opened_at, retain_until) and one created log', async () => {
    const [before, logs] = [await count(), await count('inquiry_log')];
    const body = await request();
    const r = await post(body, freshIp(), { 'user-agent': 'secret-agent/1.0' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await count()).toBe(before + 1);
    expect(await count('inquiry_log')).toBe(logs + 1);
    const row = await env.DB.prepare('SELECT * FROM inquiries WHERE email = ?1').bind(body.email).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      company: '에이스상사',
      company_no: '1234567890',
      business_type: 'retail',
      country: 'kr',
      contact_name: '김민지',
      reach_kind: 'kakao',
      reach_value: 'minji-kakao',
      wants: '["finance","sns"]',
      requests: '["demo"]',
      consent_required: 1,
      consent_demo: 1,
      consent_version: env.CONSENT_VERSION,
      consent_news: 0,
      locale: 'ko',
      source: 'demo_login',
      status: 'new',
      demo_id: null,
    });
    expect(String(row!.id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(Date.parse(String(row!.retain_until)) - Date.parse(String(row!.created_at))).toBe(365 * 86_400_000);
    expect(Date.parse(String(row!.opened_at))).toBeLessThan(Date.parse(String(row!.created_at)));
    // neither the IP nor the user-agent is kept with it
    expect(JSON.stringify(row)).not.toMatch(/203\.0\.113|secret-agent/);
    const log = await env.DB.prepare('SELECT actor, action, detail FROM inquiry_log WHERE inquiry_id = ?1').bind(row!.id).all();
    expect(log.results).toEqual([{ actor: 'system', action: 'created', detail: '{"source":"demo_login","requests":["demo"]}' }]);
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
  it('where the demo login posts; Turnstile off by default; no secrets', async () => {
    const cfg = (await (await SELF.fetch('https://marketing.test/api/config')).json()) as Record<string, unknown>;
    expect(cfg).toEqual({ demo_login_url: 'https://demo.test/api/auth/demo-login', consent_version: env.CONSENT_VERSION, turnstile: { enabled: false, site_key: '' } });
    expect(JSON.stringify(cfg)).not.toContain('test-form-secret');
  });
});
