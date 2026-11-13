// The privacy policy (`/privacy`, 2026-11-14): `/policy` lands on it, it renders in all
// three languages with the same twelve sections (the Korean one authoritative, the others say so),
// it names the representative and the contact address, and what it states matches the Worker's
// own settings (retention days, demo length, the daily sweep, the cookie, the consent version, the
// D1 location hint) — so the text cannot drift from the code without a test failing.
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { I18nProvider, type Locale } from '../src/i18n';
import { MarketingApp } from '../src/marketing/MarketingApp';
import { POLICY_SECTIONS, policyFor } from '../src/marketing/messages/policy';
import { SITE } from '../src/marketing/messages/site';

vi.mock('../src/landing/MascotCanvas', () => ({ default: () => null }));

const root = join(process.cwd(), '..');
const wrangler = readFileSync(join(root, 'marketing', 'wrangler.toml'), 'utf8');
const toml = (name: string) => wrangler.match(new RegExp(`^${name} = "([^"]*)"`, 'm'))?.[1];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function site(path: string, locale: Locale = 'ko') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  return render(
    <I18nProvider locale={locale}>
      <MemoryRouter initialEntries={[path]}>
        <MarketingApp />
        <Where />
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const text = (locale: Locale) => JSON.stringify(policyFor(locale));

describe('/privacy', () => {
  it('/policy redirects to /privacy (the address the user keeps)', () => {
    site('/policy');
    expect(screen.getByTestId('where').textContent).toBe('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: '개인정보처리방침' })).toBeTruthy();
  });

  it.each([
    ['ko', '개인정보처리방침', '1. 개인정보의 처리 목적', false],
    ['en', 'Privacy policy', '1. Why we process personal information', true],
    ['zh-CN', '隐私政策', '1. 个人信息的处理目的', true],
  ] as const)('renders in %s: the title, the twelve sections with a table of contents, the effective date', (locale, title, first, prevails) => {
    const { container } = site('/privacy', locale);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    const h2 = screen.getAllByRole('heading', { level: 2 });
    expect(h2).toHaveLength(12);
    expect(h2[0].textContent).toBe(first);
    const toc = screen.getByRole('navigation');
    expect(within(toc).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(POLICY_SECTIONS.map((id) => `#policy-${id}`));
    expect(container.textContent).toContain(SITE.policyEffective);
    // the translations say the Korean text prevails; the Korean page does not need to
    expect(!!container.querySelector('.site-policy-prevails')).toBe(prevails);
    // no draft label on the page (the note lives in the README and the code)
    expect(container.textContent).not.toMatch(/draft|초안|草案/i);
    // the officer and the contact address
    expect(container.textContent).toContain(SITE.owner[locale]);
    expect(container.textContent).toContain(SITE.email);
    // and the compact site footer under it
    expect(screen.getByTestId('site-footer').className).toContain('is-compact');
  });

  it('tables stack on a phone: every cell carries its column name', () => {
    const { container } = site('/privacy');
    const cells = [...container.querySelectorAll('.site-policy-table td')];
    expect(cells.length).toBeGreaterThan(20);
    for (const td of cells) expect(td.getAttribute('data-label')).toBeTruthy();
  });

  it('the same sections and the same shape in every language; no Hangul in the translations', () => {
    const shape = (l: Locale) => policyFor(l).sections.map((s) => [s.id, s.blocks.map((b) => Object.keys(b)[0])]);
    expect(shape('en')).toEqual(shape('ko'));
    expect(shape('zh-CN')).toEqual(shape('ko'));
    expect(text('en')).not.toMatch(/[가-힣]/);
    expect(text('zh-CN')).not.toMatch(/[가-힣]/);
  });
});

describe('what the policy states matches the Worker', () => {
  it('retention: RETAIN_DAYS = 365 is “1년 (365일)”; DEMO_DAYS = 14 is the default demo length', () => {
    expect(toml('RETAIN_DAYS')).toBe('365');
    expect(text('ko')).toContain('1년(365일)');
    expect(text('en')).toContain('1 year (365 days)');
    expect(toml('DEMO_DAYS')).toBe('14');
    expect(text('ko')).toContain('기본 14일');
  });

  it('the daily sweep at 03:17 UTC is 12:17 in Korea', () => {
    expect(wrangler).toContain('crons = ["17 3 * * *"]');
    expect(text('ko')).toContain('낮 12시 17분');
    expect(text('en')).toContain('12:17 Korean time');
    expect(text('zh-CN')).toContain('12:17');
  });

  it('the one cookie is the Worker’s demo session cookie, at most 12 hours', () => {
    const demo = readFileSync(join(root, 'marketing', 'src', 'demo.ts'), 'utf8');
    expect(demo).toContain("export const COOKIE = 'ss_demo'");
    expect(demo).toContain('const SESSION_SECONDS = 12 * 3600');
    for (const l of ['ko', 'en', 'zh-CN'] as const) expect(text(l)).toContain('ss_demo');
    expect(text('ko')).toContain('최대 12시간');
  });

  it('the consent version moved with the policy (the collected items changed)', () => {
    expect(toml('CONSENT_VERSION')).toMatch(new RegExp(`^${SITE.policyEffective}`));
  });

  it('the D1 location hint the policy states is the one the deploy steps create', () => {
    const readme = readFileSync(join(root, 'marketing', 'README.md'), 'utf8');
    expect(readme).toContain('d1 create solosquad-marketing --location apac');
    expect(text('ko')).toContain('아시아 · 태평양(APAC)');
  });

  it('no mail provider yet, and the policy says so', () => {
    const mail = readFileSync(join(root, 'marketing', 'src', 'mail.ts'), 'utf8');
    expect(mail).toMatch(/sendDemoMail[\s\S]*\{\s*return;\s*\}/);
    expect(text('ko')).toContain('메일 자동 발송 서비스를 쓰지 않아요');
  });
});
