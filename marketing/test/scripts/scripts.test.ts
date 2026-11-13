// The shared pure parts (2026-11-13): the registration number (digits only, kinds, check digits,
// the hyphens while typing), the phone, the demo password rule — one file each, used by the
// Worker, the agency CLI and the web — plus password hashes, what `route add` accepts, and SQL quoting.
import { describe, expect, it } from 'vitest';
import { businessNoOk, checkCompanyNo, corporateNoOk, digitsOf, displayCompanyNo, formatByLength, formatCompanyNo, maxDigits } from '../../scripts/lib/company-no.mjs';
import { lit, parseArgs, sql } from '../../scripts/lib/d1.mjs';
import { demoPassword, FALLBACK_WORD, wordFor, WORDS } from '../../scripts/lib/demo-password.mjs';
import { hashPassword, verifyPassword } from '../../scripts/lib/password.mjs';
import { checkPhone, formatPhone } from '../../scripts/lib/phone.mjs';
import { checkCode, checkServer } from '../../scripts/lib/routes.mjs';
import { companyNoOf } from '../../src/validate';

describe('the registration number (scripts/lib/company-no.mjs)', () => {
  it('사업자등록번호 check digit: weights 1,3,7,1,3,7,1,3,5 plus the ×5 carry', () => {
    // real published numbers and computed ones
    for (const ok of ['1248100998', '2208162517', '1234567891']) expect(businessNoOk(ok)).toBe(true);
    for (const bad of ['1248100997', '1234567890', '123456789', '12345678901', '12345a7891']) expect(businessNoOk(bad)).toBe(false);
    // the carry matters: 9th digit 9 → 9×5 = 45, + floor(45 / 10) = 49 → check 1 (without the carry it would be 5)
    expect(businessNoOk('0000000091')).toBe(true);
    expect(businessNoOk('0000000095')).toBe(false);
  });

  it('법인등록번호 check digit: weights 1,2,1,2,… mod 10', () => {
    expect(corporateNoOk('1101111234569')).toBe(true);
    expect(corporateNoOk('1101111234567')).toBe(false);
    expect(corporateNoOk('110111123456')).toBe(false);
  });

  it('checkCompanyNo: digits (hyphens and spaces allowed, full-width digits read), the length of the kind, the check digit', () => {
    expect(checkCompanyNo('123-45-67891', 'business')).toEqual({ ok: true, digits: '1234567891', kind: 'business' });
    expect(checkCompanyNo('１２３４５６７８９１', 'business')).toEqual({ ok: true, digits: '1234567891', kind: 'business' });
    expect(checkCompanyNo('110111-1234569', 'corporate')).toEqual({ ok: true, digits: '1101111234569', kind: 'corporate' });
    expect(checkCompanyNo('123-45-67890', 'business')).toEqual({ ok: false, error: 'check' });
    expect(checkCompanyNo('110111-1234569', 'business')).toEqual({ ok: false, error: 'length' });
    expect(checkCompanyNo('1234567891', 'corporate')).toEqual({ ok: false, error: 'length' });
    expect(checkCompanyNo('HRB-12345', 'foreign')).toEqual({ ok: false, error: 'invalid' });
    expect(checkCompanyNo('  ', 'business')).toEqual({ ok: false, error: 'required' });
    expect(checkCompanyNo(12345, 'foreign')).toEqual({ ok: false, error: 'required' });
    expect(checkCompanyNo('91310000', 'foreign')).toEqual({ ok: true, digits: '91310000', kind: 'foreign' });
    expect(checkCompanyNo('123', 'foreign')).toEqual({ ok: false, error: 'length' });
    expect(checkCompanyNo('1'.repeat(21), 'foreign')).toEqual({ ok: false, error: 'length' });
    // internal accounts: any 4–20 digits, no check digit
    expect(checkCompanyNo('0000000001', 'business', { internal: true })).toEqual({ ok: true, digits: '0000000001', kind: 'foreign' });
    expect(checkCompanyNo('0000000001', 'business')).toEqual({ ok: false, error: 'check' });
  });

  it('the hyphens while typing: 사업자 NNN-NN-NNNNN, 법인 NNNNNN-NNNNNNN, foreign none; capped', () => {
    expect(['1', '123', '1234', '12345', '123456', '1234567891', '123456789123'].map((d) => formatCompanyNo(d, 'business'))).toEqual(['1', '123', '123-4', '123-45', '123-45-6', '123-45-67891', '123-45-67891']);
    expect(['110111', '1101111', '1101111234569', '11011112345699'].map((d) => formatCompanyNo(d, 'corporate'))).toEqual(['110111', '110111-1', '110111-1234569', '110111-1234569']);
    expect(formatCompanyNo('12a-34', 'foreign')).toBe('1234');
    expect(formatCompanyNo('1'.repeat(25), 'foreign')).toBe('1'.repeat(20));
    expect([maxDigits('business'), maxDigits('corporate'), maxDigits('foreign')]).toEqual([10, 13, 20]);
  });

  it('the demo login: hyphens by length only (10 → 3-2-5, 13 → 6-7, else none)', () => {
    expect(formatByLength('1234567891')).toBe('123-45-67891');
    expect(formatByLength('1101111234569')).toBe('110111-1234569');
    expect(formatByLength('12345678912')).toBe('12345678912');
    expect(formatByLength('12345')).toBe('12345');
  });

  it('the Worker reads a Korean number by its kind (or its length from an older page); other countries are foreign', () => {
    expect(companyNoOf('123-45-67891', 'kr', 'business')).toMatchObject({ ok: true, kind: 'business' });
    expect(companyNoOf('1101111234569', 'kr', undefined)).toMatchObject({ ok: true, kind: 'corporate' });
    expect(companyNoOf('1234567891', 'cn', 'business')).toMatchObject({ ok: true, kind: 'foreign' });
    expect(companyNoOf('1234567890', 'kr', 'business')).toEqual({ ok: false, error: 'check' });
  });

  it('display: Korean kinds with hyphens, others plain, old rows with letters as they are', () => {
    expect(displayCompanyNo('1234567891', 'business')).toBe('123-45-67891');
    expect(displayCompanyNo('1101111234569', 'corporate')).toBe('110111-1234569');
    expect(displayCompanyNo('91310000', 'foreign')).toBe('91310000');
    expect(displayCompanyNo('1234567891', null)).toBe('123-45-67891');
    expect(displayCompanyNo('HRB-12345', null)).toBe('HRB-12345');
    expect(digitsOf('HRB-12345')).toBe('12345');
  });
});

describe('the phone (scripts/lib/phone.mjs)', () => {
  it('Korean numbers get their hyphens while typed', () => {
    const typed = ['010', '0101', '0101234', '01012345', '0101234567', '01012345678', '010123456789', '02', '021', '021234567', '0212345678', '0311234567', '03112345678', '1588', '15881', '15881234'];
    expect(typed.map((d) => formatPhone(d, 'kr'))).toEqual([
      '010',
      '010-1',
      '010-123-4',
      '010-123-45',
      '010-123-4567',
      '010-1234-5678',
      '010-1234-5678',
      '02',
      '02-1',
      '02-123-4567',
      '02-1234-5678',
      '031-123-4567',
      '031-1234-5678',
      '1588',
      '1588-1',
      '1588-1234',
    ]);
  });

  it('other countries: digits only, up to 15', () => {
    expect(formatPhone('+86 138-0013-8000', 'cn')).toBe('8613800138000');
    expect(formatPhone('1'.repeat(20), 'other')).toBe('1'.repeat(15));
  });

  it('checkPhone: Korean 02 + 7–8, 0X(X) + 8–9, 15xx + 4; others 6–15 digits; only digits and separators', () => {
    expect(checkPhone('010-1234-5678', 'kr')).toEqual({ ok: true, digits: '01012345678' });
    expect(checkPhone('02-123-4567', 'kr')).toEqual({ ok: true, digits: '021234567' });
    expect(checkPhone('1588-1234', 'kr')).toEqual({ ok: true, digits: '15881234' });
    for (const bad of ['010-123', '12345678901', '020-1234-5678', '010-1234-56789', '010-abcd-5678']) expect(checkPhone(bad, 'kr').ok).toBe(false);
    expect(checkPhone('+86 138 0013 8000', 'cn')).toEqual({ ok: true, digits: '8613800138000' });
    expect(checkPhone('12345', 'other')).toEqual({ ok: false, error: 'invalid' });
    expect(checkPhone('', 'kr')).toEqual({ ok: false, error: 'required' });
  });
});

describe('the demo password (scripts/lib/demo-password.mjs)', () => {
  it('a word for every letter a–z: easy, lower case, a apple · b banana · p penguin · s squad', () => {
    expect(Object.keys(WORDS)).toEqual([...'abcdefghijklmnopqrstuvwxyz']);
    for (const [letter, word] of Object.entries(WORDS)) {
      expect(word).toMatch(/^[a-z]{3,8}$/);
      expect(word[0]).toBe(letter);
    }
    expect([WORDS.a, WORDS.b, WORDS.p, WORDS.s]).toEqual(['apple', 'banana', 'penguin', 'squad']);
    expect(FALLBACK_WORD).toBe('squad');
  });

  it('word for the email’s first letter + the phone’s last four digits', () => {
    expect(demoPassword('abc123@gmail.com', '010-1234-5678')).toBe('apple5678');
    expect(demoPassword('Penguin.Fan@x.io', '01099990001')).toBe('penguin0001');
    expect(demoPassword('seo@x.kr', '02-123-4567')).toBe('squad4567');
  });

  it('no leading letter: the first a–z letter in the email; none at all: squad; under four digits: none', () => {
    expect(wordFor('123kim@x.com')).toBe('kite');
    expect(wordFor('_b@x.com')).toBe('banana');
    expect(wordFor('김민지@例子.中国')).toBe('squad');
    expect(demoPassword('1@2.3', '0000')).toBe('squad0000');
    expect(demoPassword('a@b.co', '123')).toBeNull();
  });

  it('the CLI (Node) makes password hashes the Worker checks — one WebCrypto file for both', async () => {
    const stored = await hashPassword('apple5678');
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword('apple5678', stored)).toBe(true);
    expect(await verifyPassword('Apple5678', stored)).toBe(false);
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
