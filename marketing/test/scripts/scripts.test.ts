// The agency scripts' pure parts (PRD §3.6.2 · §3.6.3 · C56 · C58): demo IDs `<slug>Demo` (slug
// from the company or applicant, Hangul romanised, Chinese in pinyin, legal forms dropped, 3–16,
// collisions 2, 3, …), the demo server's command, what `route add` accepts, and SQL quoting.
import { describe, expect, it } from 'vitest';
import { normalizeCompanyNo as scriptCompanyNo } from '../../scripts/lib/company-no.mjs';
import { lit, parseArgs, sql } from '../../scripts/lib/d1.mjs';
import { demoIdFor, demoIssueArgs, nextDemoId, pinyinOf, romaniseHangul, slugFrom } from '../../scripts/lib/demo-id.mjs';
import { checkCode, checkServer } from '../../scripts/lib/routes.mjs';
import { normalizeCompanyNo } from '../../src/validate';

describe('demo IDs', () => {
  it('slug from the name: Latin as is, legal forms dropped, a long name keeps its first word', () => {
    expect(slugFrom('Samsung')).toBe('samsung');
    expect(slugFrom('Samsung Electronics Co., Ltd.')).toBe('samsung');
    expect(slugFrom('Ace Mart')).toBe('acemart');
  });

  it('Hangul romanised (letter by letter — a brand spelling is the reviewer’s --slug)', () => {
    expect(romaniseHangul('삼성')).toBe('samseong');
    expect(slugFrom('삼성전자')).toBe('samseongjeonja');
    expect(slugFrom('(주)한빛')).toBe('hanbit');
    expect(slugFrom('주식회사 모아')).toBe('moa');
  });

  it('Chinese in toneless pinyin', () => {
    expect(pinyinOf('华为').trim()).toBe('huawei');
    expect(slugFrom('华为技术有限公司')).toBe('huaweijishu');
    expect(slugFrom('上海贸易有限公司')).toBe('shanghaimaoyi');
  });

  it('nothing usable → null (the applicant’s name next, then the reviewer)', () => {
    expect(slugFrom('123')).toBeNull();
    expect(slugFrom('ab')).toBeNull();
    expect(slugFrom('')).toBeNull();
    expect(slugFrom('ソニー')).toBeNull();
  });

  it('collisions count up after Demo, ignoring case (C58: samsungDemo taken → samsungDemo2)', () => {
    expect(demoIdFor('samsung')).toBe('samsungDemo');
    expect(nextDemoId('samsung', [])).toBe('samsungDemo');
    expect(nextDemoId('samsung', ['SAMSUNGDEMO'])).toBe('samsungDemo2');
    expect(nextDemoId('samsung', ['samsungDemo', 'samsungDemo2'])).toBe('samsungDemo3');
  });

  it('the demo server’s command (engine demo mode) carries the inquiry’s company number', () => {
    expect(demoIssueArgs({ demoId: 'samsungDemo2', inquiryId: '01J', companyNo: '1234567890', days: 14, locale: 'ko' }).join(' ')).toBe(
      'solosquad demo issue --id samsungDemo2 --inquiry 01J --company-no 1234567890 --days 14 --locale ko',
    );
    expect(() => demoIssueArgs({ demoId: 'samsungDemo2', inquiryId: '01J', companyNo: null })).toThrow(/company registration number/);
  });

  it('the scripts normalise a company number exactly as the Worker does', () => {
    const samples = ['123-45-67890', ' 110111-1234567 ', '１２３４５６７８９０', 'hrb-12345', '91310000MA1FL', '123', 'x'.repeat(31), '12_34', ''];
    for (const country of ['kr', 'cn', 'other', undefined]) {
      for (const raw of samples) expect(scriptCompanyNo(raw, country)).toBe(normalizeCompanyNo(raw, country));
    }
    expect(scriptCompanyNo('123-45-67890')).toBe('1234567890');
  });
});

describe('route add', () => {
  it('company codes: a-z 0-9, 3–20, lower-cased; demo and …demo refused (C56)', () => {
    expect(checkCode('MOA')).toEqual({ ok: true, code: 'moa' });
    expect(checkCode('mo').ok).toBe(false);
    expect(checkCode('mo-a').ok).toBe(false);
    expect(checkCode('demo')).toMatchObject({ ok: false, error: expect.stringContaining('reserved') });
    expect(checkCode('acmedemo')).toMatchObject({ ok: false, error: expect.stringContaining('reserved') });
  });

  it('servers: https origin only (http://127.0.0.1 only for the local D1)', () => {
    expect(checkServer('https://office.moa.co.kr/')).toEqual({ ok: true, url: 'https://office.moa.co.kr' });
    expect(checkServer('http://office.moa.co.kr').ok).toBe(false);
    expect(checkServer('https://office.moa.co.kr/login?next=//evil').ok).toBe(false);
    expect(checkServer('https://u:p@office.moa.co.kr').ok).toBe(false);
    expect(checkServer('http://127.0.0.1:8792').ok).toBe(false);
    expect(checkServer('http://127.0.0.1:8792', { allowLocal: true })).toEqual({ ok: true, url: 'http://127.0.0.1:8792' });
  });
});

describe('SQL quoting for wrangler d1 execute', () => {
  it('quotes every value', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(lit(null)).toBe('NULL');
    expect(lit(3)).toBe('3');
    expect(() => lit(Number.NaN)).toThrow();
    expect(sql`SELECT * FROM inquiries WHERE id = ${"x'; DROP TABLE inquiries; --"}`).toBe("SELECT * FROM inquiries WHERE id = 'x''; DROP TABLE inquiries; --'");
  });

  it('parses flags', () => {
    expect(parseArgs(['issue', '01J', '--slug', 'samsung', '--remote', '--days=7'])).toEqual({ pos: ['issue', '01J'], opts: { slug: 'samsung', remote: true, days: '7' } });
  });
});
