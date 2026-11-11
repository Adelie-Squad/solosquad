// The marketing site's pages (decision 62, PRD §3.6): the login router (a plain form: company code
// + ID → POST /api/login/route, no password, the code remembered), its neutral /login/help, the
// demo login (one ID + password form posting straight to the demo server, ?u= prefill) and the
// request modal it opens (requests, source, the demo-usage consent, validation, submission,
// success and error states), the privacy placeholder, and the marketing build's entry.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, type Locale } from '../src/i18n';
import { MarketingApp } from '../src/marketing/MarketingApp';
import { resetSiteConfig } from '../src/marketing/siteApi';

// the 3D chunk is not loaded in jsdom
vi.mock('../src/landing/MascotCanvas', () => ({ default: () => null }));

type Call = { url: string; body: Record<string, unknown> | null };

/** The marketing Worker, faked: config, form token and requests. */
function stubSite(opts: { inquiry?: (b: Record<string, unknown>) => Response } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, body });
      if (url === '/api/config') return new Response(JSON.stringify({ demo_login_url: 'https://demo.example/api/auth/demo-login', consent_version: 'v1', turnstile: { enabled: false, site_key: '' } }));
      if (url === '/api/form-token') return new Response(JSON.stringify({ token: '123.abc' }));
      if (url === '/api/inquiry') return opts.inquiry?.(body!) ?? new Response(JSON.stringify({ ok: true }));
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

function site(path: string, locale: Locale = 'ko') {
  return render(
    <I18nProvider locale={locale}>
      <MemoryRouter initialEntries={[path]}>
        <MarketingApp />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  resetSiteConfig();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the login router (/login)', () => {
  it('a plain form posting company code and ID to /api/login/route — works without JS, no password', () => {
    stubSite();
    site('/login');
    const form = screen.getByTestId('router-form') as HTMLFormElement;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/login/route');
    expect((screen.getByLabelText(/회사 코드/) as HTMLInputElement).name).toBe('code');
    expect((screen.getByLabelText('아이디') as HTMLInputElement).name).toBe('id');
    expect(screen.getByText('사무실을 만들 때 받은 회사 코드예요.')).toBeTruthy();
    expect(screen.getByText('회사 코드를 모르세요? 사무실을 만든 담당자에게 물어봐 주세요.')).toBeTruthy();
    expect(form.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('button', { name: '다음' })).toBeTruthy();
  });

  it('remembers the company code on this device (local storage, not a cookie)', () => {
    stubSite();
    site('/login');
    fireEvent.change(screen.getByLabelText(/회사 코드/), { target: { value: ' MOA ' } });
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'kim' } });
    const form = screen.getByTestId('router-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.submit(form);
    expect(localStorage.getItem('solosquad.companyCode')).toBe('moa');
    cleanup();
    site('/login');
    expect((screen.getByLabelText(/회사 코드/) as HTMLInputElement).value).toBe('moa');
  });

  it('/login/help: the one neutral page — says nothing does not exist, back to the form, the demo login', () => {
    stubSite();
    site('/login/help');
    const page = screen.getByTestId('router-help');
    expect(within(page).getByRole('heading', { name: '회사 서버 주소를 확인해 주세요' })).toBeTruthy();
    expect(page.textContent).not.toMatch(/없는|존재|등록되지|not found|does not exist|unknown/i);
    expect(within(page).getByRole('link', { name: '다시 입력하기' }).getAttribute('href')).toBe('/login');
    expect(within(page).getByRole('link', { name: '데모 로그인' }).getAttribute('href')).toBe('/demo');
  });

  it('three languages', () => {
    stubSite();
    site('/login', 'en');
    expect(screen.getByLabelText(/Company code/)).toBeTruthy();
    cleanup();
    site('/login', 'zh-CN');
    expect(screen.getByLabelText(/公司代码/)).toBeTruthy();
    expect(screen.getByText('搭建办公室时收到的公司代码。')).toBeTruthy();
  });
});

describe('the demo login (/demo)', () => {
  it('one ID + password form that posts straight to the demo server — the site never sees the password', async () => {
    const calls = stubSite();
    site('/demo');
    const form = screen.getByTestId('demo-form') as HTMLFormElement;
    await waitFor(() => expect(form.getAttribute('action')).toBe('https://demo.example/api/auth/demo-login'));
    expect(form.method).toBe('post');
    expect(within(form).getByLabelText('아이디')).toHaveProperty('name', 'username');
    expect(within(form).getByLabelText('비밀번호')).toHaveProperty('name', 'password');
    expect((within(form).getByLabelText('아이디') as HTMLInputElement).placeholder).toBe('samsungDemo');
    expect(screen.getByText('데모는 예시 데이터로 움직여요.')).toBeTruthy();
    expect(screen.queryByLabelText(/회사 코드/)).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(['/api/config']);
  });

  it('?u= fills the demo ID (the router sends the code demo here)', () => {
    stubSite();
    site('/demo?u=samsungDemo');
    expect((screen.getByLabelText('아이디') as HTMLInputElement).value).toBe('samsungDemo');
  });
});

describe('the request modal', () => {
  const open = async () => {
    site('/demo');
    fireEvent.click(screen.getByTestId('demo-apply'));
    return screen.findByRole('dialog', { name: '데모 계정 신청하기' });
  };
  const fill = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText(/^회사 이름/), { target: { value: '에이스상사' } });
    fireEvent.change(within(dialog).getByLabelText(/^업종/), { target: { value: 'retail' } });
    fireEvent.change(within(dialog).getByLabelText(/^담당자 이름/), { target: { value: '김민지' } });
    fireEvent.change(within(dialog).getByLabelText(/^이메일/), { target: { value: 'minji@example.com' } });
    fireEvent.click(within(dialog).getByLabelText('재무 관리'));
    fireEvent.click(within(dialog).getByLabelText('개인정보 수집 · 이용에 동의해요(필수)'));
    fireEvent.click(within(dialog).getByLabelText(/^데모 사용 기록/));
  };
  const send = async (dialog: HTMLElement) => {
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '신청 보내기' }));
    });
  };

  it('opens from the demo login with 데모 계정 pre-checked, the fields, and a link to the privacy page', async () => {
    stubSite();
    const dialog = await open();
    expect((within(dialog).getByLabelText('데모 계정') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('상담') as HTMLInputElement).checked).toBe(false);
    for (const label of [/^회사 이름/, /^업종/, /^나라/, /^담당자 이름/, /^이메일/, '연락 방법', '재무 관리', '상품 소싱', 'SNS 마케팅', '새 소식 받기(선택)']) expect(within(dialog).getByLabelText(label)).toBeTruthy();
    expect((within(dialog).getByLabelText(/^나라/) as HTMLSelectElement).value).toBe('kr');
    expect((within(dialog).getByLabelText('연락 방법') as HTMLSelectElement).value).toBe('kakao');
    expect(within(dialog).getByRole('link', { name: '개인정보처리방침 보기' }).getAttribute('href')).toBe('/privacy');
    const trap = dialog.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('the demo-usage consent line shows only while 데모 계정 is asked for (DM6 ⓑ)', async () => {
    stubSite();
    const dialog = await open();
    expect(within(dialog).getByLabelText(/^데모 사용 기록/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('데모 계정'));
    expect(within(dialog).queryByLabelText(/^데모 사용 기록/)).toBeNull();
  });

  it('validation: marks every missing field and sends nothing', async () => {
    const calls = stubSite();
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText(/^이메일/), { target: { value: 'not-an-email' } });
    await send(dialog);
    expect(within(dialog).getByRole('alert').textContent).toBe('표시한 칸을 확인해 주세요.');
    expect(within(dialog).getByText('이메일 주소를 확인해 주세요.')).toBeTruthy();
    expect(within(dialog).getByText('하나 이상 골라 주세요.')).toBeTruthy();
    expect(within(dialog).getAllByText('동의해야 신청할 수 있어요.')).toHaveLength(2);
    expect(within(dialog).getByLabelText(/^회사 이름/).getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((c) => c.url === '/api/inquiry')).toBe(false);
  });

  it('submits to /api/inquiry with source, requests and the form token, then the success state', async () => {
    const calls = stubSite();
    const dialog = await open();
    fill(dialog);
    await send(dialog);
    const done = await screen.findByRole('dialog', { name: '신청을 받았어요' });
    expect(within(done).getByText('확인하고 데모 계정을 메일로 보내 드려요.')).toBeTruthy();
    expect(within(done).getByText('에이스상사')).toBeTruthy();
    const sent = calls.find((c) => c.url === '/api/inquiry')!.body!;
    expect(sent).toMatchObject({
      company: '에이스상사',
      business_type: 'retail',
      country: 'kr',
      contact_name: '김민지',
      email: 'minji@example.com',
      wants: ['finance'],
      requests: ['demo'],
      consent_required: true,
      consent_demo: true,
      consent_news: false,
      website: '',
      locale: 'ko',
      source: 'demo_login',
      form_token: '123.abc',
    });
    expect(sent.reach_value).toBeUndefined();
  });

  it('a refusal from the server keeps what was typed and says why', async () => {
    stubSite({ inquiry: () => new Response(JSON.stringify({ error: 'invalid', fields: { email: 'invalid' } }), { status: 400 }) });
    const dialog = await open();
    fill(dialog);
    await send(dialog);
    expect(await within(dialog).findByText('이메일 주소를 확인해 주세요.')).toBeTruthy();
    expect((within(dialog).getByLabelText(/^회사 이름/) as HTMLInputElement).value).toBe('에이스상사');
  });

  it.each([
    [{ status: 429, body: { error: 'rate_limited' } }, '신청이 너무 많이 들어왔어요. 잠시 뒤 다시 보내 주세요.'],
    [{ status: 400, body: { error: 'too_fast' } }, '양식을 연 지 오래됐어요. 몇 초 뒤 다시 보내 주세요.'],
    [{ status: 500, body: { error: 'server_error' } }, '보내지 못했어요. 입력한 내용은 그대로 있어요. 잠시 뒤 다시 보내 주세요.'],
  ])('error state %#', async (res, message) => {
    stubSite({ inquiry: () => new Response(JSON.stringify(res.body), { status: res.status }) });
    const dialog = await open();
    fill(dialog);
    await send(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByRole('dialog', { name: '신청을 받았어요' })).toBeNull();
  });
});

describe('the other pages and the build', () => {
  it('/privacy is a placeholder marked for legal review', () => {
    stubSite();
    site('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: '개인정보처리방침' })).toBeTruthy();
    expect(screen.getByText('법률 검토 필요 — 초안이에요')).toBeTruthy();
  });

  it('the marketing build swaps the entry and writes to marketing/public; the customer build is unchanged', () => {
    const cfg = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(cfg).toContain("html.replace('/src/main.tsx', '/src/marketing/main.tsx')");
    expect(cfg).toMatch(/outDir: join\(here, '\.\.', 'marketing', 'public'\)/);
    expect(cfg).toContain("outDir: 'dist'");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:marketing']).toBe('vite build --mode marketing');
  });
});
