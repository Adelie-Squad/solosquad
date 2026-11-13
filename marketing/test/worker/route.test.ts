// The login router (PRD §3.6.2 · C55 · C56): a form post {code, id} answered with a 303 — a known
// active company code to that server's login with the ID passed on, `demo` to the demo login, and
// everything else to the same neutral /login/help; the same timing; 10 a minute per IP; no IDs or
// passwords stored.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { destination, normaliseCode, passableId, reservedCode } from '../../src/route';

let n = 0;
const freshIp = () => `198.51.100.${++n}`;

const route = (fields: Record<string, string>, ip = freshIp(), type = 'application/x-www-form-urlencoded') =>
  SELF.fetch('https://marketing.test/api/login/route', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': type, 'cf-connecting-ip': ip },
    body: new URLSearchParams(fields).toString(),
  });

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_routes (code, kind, server_url, status, updated_at, updated_by) VALUES ('moa', 'customer', 'https://office.moa.co.kr', 'active', '2026-11-11T00:00:00Z', 'test')"),
    env.DB.prepare("INSERT INTO login_routes (code, kind, server_url, status, updated_at, updated_by) VALUES ('old', 'customer', 'https://office.old.example', 'suspended', '2026-11-11T00:00:00Z', 'test')"),
  ]);
});

describe('POST /api/login/route', () => {
  it('a known code: 303 to that server’s login with the ID as typed — no code prefix, whatever the ID', async () => {
    for (const [code, id] of [
      ['moa', 'kim'],
      ['MOA', 'nobody'],
      [' moa ', 'Kim.Lee@x'],
    ]) {
      const r = await route({ code, id });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`https://office.moa.co.kr/login?u=${encodeURIComponent(id.trim())}`);
    }
  });

  it('the reserved code demo: 303 to the demo login with the ID', async () => {
    for (const [code, id] of [
      ['demo', 'samsungDemo'],
      ['DEMO', 'samsungdemo'],
    ]) {
      const r = await route({ code, id });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`https://marketing.test/demo?u=${id}`);
    }
  });

  it('unknown · suspended · empty · malformed: the same 303 to /login/help — same status, headers and body', async () => {
    const tries = [
      { code: 'zzz', id: 'kim' },
      { code: 'old', id: 'kim' },
      { code: '', id: 'kim' },
      { code: 'moa', id: '' },
      { code: '<script>', id: 'kim' },
      { code: 'moa', id: '<script>' },
      { code: 'mo', id: 'kim' },
      { code: 'acmedemo', id: 'kim' },
      { id: 'kim' },
    ];
    const answers = await Promise.all(tries.map((t) => route(t as Record<string, string>)));
    answers.push(await route({ code: 'moa', id: 'kim' }, freshIp(), 'application/json'));
    const bodies = await Promise.all(answers.map((r) => r.text()));
    expect(new Set(answers.map((r) => r.status))).toEqual(new Set([303]));
    expect(new Set(answers.map((r) => r.headers.get('location')))).toEqual(new Set(['https://marketing.test/login/help']));
    expect(new Set(bodies)).toEqual(new Set(['']));
    expect(new Set(answers.map((r) => [...r.headers].map(([k, v]) => `${k}:${v}`).sort().join('|'))).size).toBe(1);
  });

  it('found and not found take at least the same padded time', async () => {
    for (const code of ['moa', 'zzz']) {
      const t = Date.now();
      await (await route({ code, id: 'kim' })).text();
      expect(Date.now() - t).toBeGreaterThanOrEqual(38);
    }
  });

  it('per IP: the 11th within a minute goes to the neutral page, even for a known code', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await route({ code: 'moa', id: 'kim' }, ip)).headers.get('location')).toContain('office.moa.co.kr');
    expect((await route({ code: 'moa', id: 'kim' }, ip)).headers.get('location')).toBe('https://marketing.test/login/help');
  });

  it('stores no ID and no password anywhere', async () => {
    await (await route({ code: 'moa', id: 'secret-person', password: 'hunter2' })).text();
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name != 'd1_migrations'").all<{ name: string }>()).results;
    for (const { name } of tables) {
      const dump = JSON.stringify((await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results);
      expect(dump).not.toContain('secret-person');
      expect(dump).not.toContain('hunter2');
    }
  });
});

describe('company codes and the decision', () => {
  it('a-z 0-9, 3–20, any case in; demo and …demo reserved', () => {
    expect(normaliseCode(' MOA ')).toBe('moa');
    expect(normaliseCode('mo')).toBeNull();
    expect(normaliseCode('a'.repeat(21))).toBeNull();
    expect(normaliseCode('mo-a')).toBeNull();
    expect(reservedCode('demo')).toBe(true);
    expect(reservedCode('acmedemo')).toBe(true);
    expect(reservedCode('demolition')).toBe(false);
  });

  it('IDs: passed through when a login field could hold them', () => {
    expect(passableId(' kim ')).toBe('kim');
    expect(passableId('a b')).toBeNull();
    expect(passableId('x'.repeat(121))).toBeNull();
  });

  it('a customer row whose code is reserved never routes (a hand-made row cannot shadow the demo)', () => {
    expect(destination({ kind: 'customer', server_url: 'https://x.example', status: 'active' }, 'xdemo', 'kim')).toBe('/login/help');
    expect(destination({ kind: 'demo', server_url: '/demo', status: 'active' }, 'other', 'kim')).toBe('/login/help');
  });

  it('the demo row is in the migration', async () => {
    expect(await env.DB.prepare("SELECT kind, server_url, status FROM login_routes WHERE code = 'demo'").first()).toEqual({ kind: 'demo', server_url: '/demo', status: 'active' });
  });
});

describe('the privacy policy’s old address (2026-11-14)', () => {
  it('/privacy → 301 /policy, the query kept', async () => {
    for (const [from, to] of [
      ['/privacy', '/policy'],
      ['/privacy/', '/policy'],
      ['/privacy?lang=en', '/policy?lang=en'],
    ]) {
      const r = await SELF.fetch(`https://marketing.test${from}`, { redirect: 'manual' });
      expect(r.status).toBe(301);
      expect(r.headers.get('location')).toBe(`https://marketing.test${to}`);
    }
  });
});
