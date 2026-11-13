// The marketing site's pages (decision 62, PRD §3.6): the login router (a plain form: company code
// + ID → POST /api/login/route, no password, the code remembered), its neutral /login/help, the
// demo login (one company registration number + ID + password form posted to the site’s own
// server, ?u= prefill) and the request modal it opens (requests, source, the company registration
// number, the demo-usage consent, validation, submission,
// success and error states), the privacy placeholder, and the marketing build's entry.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
      if (url === '/api/config') return new Response(JSON.stringify({ consent_version: 'v1', turnstile: { enabled: false, site_key: '' } }));
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
  it('one plain form — company registration number + ID + password — posted to this site’s demo login (works without JS)', async () => {
    const calls = stubSite();
    site('/demo');
    const form = screen.getByTestId('demo-form') as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('/api/demo/login');
    expect(form.method).toBe('post');
    expect(within(form).getByRole('button', { name: '데모 시작하기' })).toHaveProperty('disabled', false);
    const number = within(form).getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement;
    expect(number.name).toBe('company_no');
    expect(number.required).toBe(true);
    expect(within(form).getByText('데모를 신청할 때 적은 번호예요. 숫자만 치면 돼요.')).toBeTruthy();
    expect(within(form).getByText('신청할 때 적은 이메일이에요.')).toBeTruthy();
    expect(number.inputMode).toBe('numeric');
    expect([...form.querySelectorAll('input')].map((i) => i.name)).toEqual(['company_no', 'username', 'password']);
    expect(within(form).queryByLabelText(/법인명|회사 이름/)).toBeNull();
    expect(within(form).getByLabelText(/^아이디/)).toHaveProperty('name', 'username');
    expect(within(form).getByLabelText('비밀번호')).toHaveProperty('name', 'password');
    expect((within(form).getByLabelText(/^아이디/) as HTMLInputElement).placeholder).toBe('name@company.com');
    expect(screen.getByText('데모는 예시 데이터로 움직여요.')).toBeTruthy();
    expect(screen.queryByLabelText(/회사 코드/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // nothing to ask the site before the form works
    expect(calls).toEqual([]);
  });

  it('the number takes digits only and shows hyphens by length: 10 → 3-2-5, 13 → 6-7, else none', () => {
    stubSite();
    site('/demo');
    const number = screen.getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement;
    const type = (v: string) => {
      fireEvent.change(number, { target: { value: v } });
      return number.value;
    };
    expect(type('12345')).toBe('12345');
    expect(type('1234567891')).toBe('123-45-67891');
    expect(type('123-45-678912')).toBe('12345678912');
    expect(type('1101111234569')).toBe('110111-1234569');
    expect(type('abc１２３4')).toBe('1234');
    expect(type('1'.repeat(30))).toBe('1'.repeat(20));
  });

  it('?error=1 (every failure the same): one sentence, no hint at which field was wrong', () => {
    stubSite();
    site('/demo?error=1&u=samsungDemo');
    expect(screen.getByRole('alert').textContent).toBe('법인(사업자)등록번호 · 아이디 · 비밀번호를 다시 확인해 주세요. 데모 기간이 끝났다면 담당자에게 알려 주세요.');
    expect((screen.getByLabelText(/^아이디/) as HTMLInputElement).value).toBe('samsungDemo');
  });

  it('?u= fills the demo ID (the router sends the code demo here); the number is still asked for', () => {
    stubSite();
    site('/demo?u=samsungDemo');
    expect((screen.getByLabelText(/^아이디/) as HTMLInputElement).value).toBe('samsungDemo');
    expect((screen.getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement).value).toBe('');
  });

  it('a country select (한국 by default): 중국 takes the 统一社会信用代码 with letters, upper-cased; 기타 letters and digits; not sent', () => {
    stubSite();
    site('/demo');
    const country = screen.getByTestId('demo-country') as HTMLSelectElement;
    expect(country.value).toBe('kr');
    expect(country.name).toBe('');
    fireEvent.change(country, { target: { value: 'cn' } });
    const no = screen.getByLabelText(/^통일사회신용코드/) as HTMLInputElement;
    expect(no.name).toBe('company_no');
    expect(screen.getByText('데모를 신청할 때 적은 통일사회신용코드 18자리예요. 영문은 대문자로 바뀌어요.')).toBeTruthy();
    fireEvent.change(no, { target: { value: '913501 00m000100y43xx' } });
    expect(no.value).toBe('91350100M000100Y43');
    fireEvent.change(country, { target: { value: 'kr' } });
    expect((screen.getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement).value).toBe('9135010000010043');
    fireEvent.change(country, { target: { value: 'other' } });
    const other = screen.getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement;
    fireEvent.change(other, { target: { value: 'hrb-12345' } });
    expect(other.value).toBe('HRB12345');
    cleanup();
    site('/demo', 'zh-CN');
    fireEvent.change(screen.getByTestId('demo-country'), { target: { value: 'cn' } });
    expect(screen.getByLabelText(/^统一社会信用代码/)).toHaveProperty('name', 'company_no');
  });

  it('the three fields in English and Chinese', () => {
    stubSite();
    site('/demo', 'en');
    expect(screen.getByLabelText(/^Company registration number/)).toHaveProperty('name', 'company_no');
    cleanup();
    site('/demo', 'zh-CN');
    expect(screen.getByLabelText(/^企业注册号/)).toHaveProperty('name', 'company_no');
  });
});

describe('the request modal', () => {
  const open = async () => {
    site('/demo');
    fireEvent.click(screen.getByTestId('demo-apply'));
    return screen.findByRole('dialog', { name: '데모 계정 신청하기' });
  };
  const number = (dialog: HTMLElement) => within(dialog).getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement;
  const phone = (dialog: HTMLElement) => within(dialog).getByLabelText(/^전화번호/) as HTMLInputElement;
  const fill = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText(/^회사 이름/), { target: { value: '에이스상사' } });
    fireEvent.change(number(dialog), { target: { value: '123-45-67891' } });
    fireEvent.change(within(dialog).getByLabelText(/^업종/), { target: { value: 'retail' } });
    fireEvent.change(within(dialog).getByLabelText(/^담당자 이름/), { target: { value: '김민지' } });
    fireEvent.change(within(dialog).getByLabelText(/^이메일/), { target: { value: 'minji@example.com' } });
    fireEvent.change(phone(dialog), { target: { value: '01012345678' } });
    fireEvent.click(within(dialog).getByLabelText('재무 관리'));
    fireEvent.click(within(dialog).getByLabelText('개인정보 수집 · 이용에 동의해요(필수)'));
    fireEvent.click(within(dialog).getByLabelText(/^데모 사용 기록/));
  };
  const send = async (dialog: HTMLElement) => {
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '신청 보내기' }));
    });
  };
  const issued = {
    id: 'minji@example.com',
    password: 'moon5678',
    company_no: '1234567891',
    company_no_kind: 'business',
    company_name: '에이스상사',
    expires: '2026-11-28T00:00:00.000Z',
    reused: false,
  };

  it('opens from the demo login with 데모 계정 pre-checked, the fields, and a link to the privacy page', async () => {
    stubSite();
    const dialog = await open();
    expect((within(dialog).getByLabelText('데모 계정') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('상담') as HTMLInputElement).checked).toBe(false);
    for (const label of [/^회사 이름/, /^법인\(사업자\)등록번호/, /^업종/, /^나라/, /^담당자 이름/, /^이메일/, /^전화번호/, '메신저', '재무 관리', '상품 소싱', 'SNS 마케팅', '새 소식 받기(선택)']) expect(within(dialog).getByLabelText(label)).toBeTruthy();
    expect((within(dialog).getByLabelText(/^나라/) as HTMLSelectElement).value).toBe('kr');
    const messenger = within(dialog).getByLabelText('메신저') as HTMLSelectElement;
    expect(messenger.value).toBe('kakao');
    expect([...messenger.options].map((o) => o.value)).toEqual(['kakao', 'wechat']);
    expect(within(dialog).getByRole('link', { name: '개인정보처리방침 보기' }).getAttribute('href')).toBe('/privacy');
    const trap = dialog.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('the demo-usage consent line and the phone’s password hint show only while 데모 계정 is asked for (DM6 ⓑ)', async () => {
    stubSite();
    const dialog = await open();
    expect(within(dialog).getByLabelText(/^데모 사용 기록/)).toBeTruthy();
    expect(within(dialog).getByText('뒤 4자리가 데모 비밀번호에 들어가요. 숫자만 치면 돼요.')).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('데모 계정'));
    expect(within(dialog).queryByLabelText(/^데모 사용 기록/)).toBeNull();
    expect(within(dialog).queryByText('뒤 4자리가 데모 비밀번호에 들어가요. 숫자만 치면 돼요.')).toBeNull();
    expect(phone(dialog).parentElement!.textContent).toContain('선택');
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
    expect(number(dialog).getAttribute('aria-invalid')).toBe('true');
    // the phone is required with a demo account
    expect(phone(dialog).getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((c) => c.url === '/api/inquiry')).toBe(false);
  });

  it('the number: 개인사업자 / 법인 toggle, digits only, hyphens as typed, capped, the check digit', async () => {
    const calls = stubSite();
    const dialog = await open();
    const toggle = within(dialog).getByRole('radiogroup', { name: '사업자 구분' });
    const [sole, corp] = within(toggle).getAllByRole('radio');
    expect([sole.textContent, corp.textContent]).toEqual(['개인사업자', '법인']);
    expect(sole.getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByText('사업자등록번호 10자리 — 숫자만 치면 돼요. 데모 로그인할 때 이 번호를 다시 적어요.')).toBeTruthy();
    const no = number(dialog);
    expect(no.inputMode).toBe('numeric');
    expect(no.placeholder).toBe('123-45-67890');
    const type = (v: string) => {
      fireEvent.change(no, { target: { value: v } });
      return no.value;
    };
    expect(type('123')).toBe('123');
    expect(type('1234')).toBe('123-4');
    expect(type('12345a6')).toBe('123-45-6');
    expect(type('１２３４５６７８９１')).toBe('123-45-67891');
    expect(type('123456789123')).toBe('123-45-67891'); // 10 at most
    // 법인: 13 digits, NNNNNN-NNNNNNN — the digits typed so far stay
    fireEvent.click(corp);
    expect(corp.getAttribute('aria-checked')).toBe('true');
    expect(no.value).toBe('123456-7891');
    expect(no.placeholder).toBe('123456-1234567');
    expect(type('11011112345699')).toBe('110111-1234569');

    fill(dialog);
    fireEvent.click(sole);
    type('123-45-6789');
    await send(dialog);
    expect(within(dialog).getByText('사업자등록번호는 10자리예요.')).toBeTruthy();
    type('1234567890');
    await send(dialog);
    expect(within(dialog).getByText('번호가 맞지 않아요. 숫자를 다시 확인해 주세요.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/inquiry')).toBe(false);
    fireEvent.click(corp);
    type('1101111234569');
    await send(dialog);
    expect(calls.find((c) => c.url === '/api/inquiry')!.body).toMatchObject({ company_no: '1101111234569', company_no_kind: 'corporate' });
  });

  it('the country comes first and is 한국 by default — in every language (2026-11-14)', async () => {
    for (const locale of ['ko', 'zh-CN', 'en'] as const) {
      stubSite();
      site('/demo', locale);
      fireEvent.click(screen.getByTestId('demo-apply'));
      const dialog = await screen.findByRole('dialog');
      const country = within(dialog).getByTestId('inquiry-country') as HTMLSelectElement;
      expect(country.value).toBe('kr');
      expect([...country.options].map((o) => o.value)).toEqual(['kr', 'cn', 'other']);
      // the first field of the company block
      expect(dialog.querySelector('.inquiry-grid .field select, .inquiry-grid .field input')).toBe(country);
      cleanup();
    }
  });

  it('China: 统一社会信用代码 (18, letters upper-cased as typed, the check character) and a mobile (+86 taken off)', async () => {
    const calls = stubSite();
    const dialog = await open();
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText(/^나라/), { target: { value: 'cn' } });
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    const no = within(dialog).getByLabelText(/^통일사회신용코드/) as HTMLInputElement;
    expect(within(dialog).getByText(/^통일사회신용코드\(统一社会信用代码\) 18자리/)).toBeTruthy();
    expect(no.inputMode).toBe('text');
    expect(no.placeholder).toBe('91350100M000100Y43');
    fireEvent.change(no, { target: { value: '9135-0100 m000100y4' } });
    expect(no.value).toBe('91350100M000100Y4');
    await send(dialog);
    expect(within(dialog).getByText('통일사회신용코드는 18자리예요.')).toBeTruthy();
    fireEvent.change(no, { target: { value: '91350100M000100Y44' } });
    await send(dialog);
    expect(within(dialog).getByText('번호가 맞지 않아요. 숫자를 다시 확인해 주세요.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/inquiry')).toBe(false);
    fireEvent.change(no, { target: { value: '91350100m000100y43zz' } });
    expect(no.value).toBe('91350100M000100Y43');
    const p = within(dialog).getByLabelText(/^휴대전화 번호/) as HTMLInputElement;
    expect(p.placeholder).toBe('138-0013-8000');
    fireEvent.change(p, { target: { value: '13800138000' } });
    expect(p.value).toBe('138-0013-8000');
    fireEvent.change(p, { target: { value: '+86 138 0013 8000' } });
    expect(p.value).toBe('+86 138-0013-8000');
    await send(dialog);
    const body = calls.find((c) => c.url === '/api/inquiry')!.body!;
    expect(body).toMatchObject({ country: 'cn', company_no: '91350100M000100Y43', phone: '8613800138000' });
    expect(body.company_no_kind).toBeUndefined();
  });

  it('another country: letters and digits (4–20), no hyphens; the phone digits only; back to 한국 keeps the digits', async () => {
    const calls = stubSite();
    const dialog = await open();
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText(/^나라/), { target: { value: 'other' } });
    fireEvent.change(number(dialog), { target: { value: 'hrb-12345' } });
    expect(number(dialog).value).toBe('HRB12345');
    fireEvent.change(phone(dialog), { target: { value: '+49 151 1234 5678' } });
    expect(phone(dialog).value).toBe('4915112345678');
    fireEvent.change(within(dialog).getByLabelText(/^나라/), { target: { value: 'kr' } });
    expect(number(dialog).value).toBe('123-45');
    fireEvent.change(within(dialog).getByLabelText(/^나라/), { target: { value: 'other' } });
    fireEvent.change(number(dialog), { target: { value: 'hrb-12345' } });
    fireEvent.change(phone(dialog), { target: { value: '+49 151 1234 5678' } });
    await send(dialog);
    expect(calls.find((c) => c.url === '/api/inquiry')!.body).toMatchObject({ country: 'other', company_no: 'HRB12345', phone: '4915112345678' });
  });

  it('the phone: digits only, Korean hyphens as typed, checked', async () => {
    const calls = stubSite();
    const dialog = await open();
    const p = phone(dialog);
    expect(p.inputMode).toBe('numeric');
    expect(p.placeholder).toBe('010-1234-5678');
    const type = (v: string) => {
      fireEvent.change(p, { target: { value: v } });
      return p.value;
    };
    expect(type('0101234')).toBe('010-123-4');
    expect(type('010-1234-5678')).toBe('010-1234-5678');
    expect(type('021234567')).toBe('02-123-4567');
    expect(type('0212345678')).toBe('02-1234-5678');
    expect(type('010123456789')).toBe('010-1234-5678');
    fill(dialog);
    type('010123');
    await send(dialog);
    expect(within(dialog).getByText('전화번호를 확인해 주세요.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/inquiry')).toBe(false);
  });

  it('submits to /api/inquiry with source, requests, digits and the form token; no account back → the received state', async () => {
    const calls = stubSite();
    const dialog = await open();
    fill(dialog);
    await send(dialog);
    const done = await screen.findByRole('dialog', { name: '신청을 받았어요' });
    expect(within(done).getByText('확인하고 데모 계정을 메일로 보내 드려요.')).toBeTruthy();
    expect(within(done).getByText('에이스상사')).toBeTruthy();
    expect(within(done).getByText('123-45-67891')).toBeTruthy();
    const sent = calls.find((c) => c.url === '/api/inquiry')!.body!;
    expect(sent).toMatchObject({
      company: '에이스상사',
      company_no: '1234567891',
      company_no_kind: 'business',
      business_type: 'retail',
      country: 'kr',
      contact_name: '김민지',
      email: 'minji@example.com',
      phone: '01012345678',
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

  it('the account comes back → the completion screen shows number, ID, password and end, and starts the demo login filled in (no password)', async () => {
    stubSite({ inquiry: () => new Response(JSON.stringify({ ok: true, demo: issued })) });
    const dialog = await open();
    fill(dialog);
    await send(dialog);
    const done = await screen.findByRole('dialog', { name: '데모 계정이 나왔어요' });
    expect(within(done).getByText('아래 정보로 바로 데모에 로그인할 수 있어요. 이 화면을 닫기 전에 적어 두세요.')).toBeTruthy();
    const account = within(done).getByTestId('inquiry-account');
    const pairs = [...account.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    expect(pairs).toEqual([
      ['법인(사업자)등록번호', '123-45-67891'],
      ['아이디', 'minji@example.com'],
      ['비밀번호', 'moon5678'],
      ['사용 기간', `${new Date('2026-11-28T00:00:00.000Z').toLocaleDateString('ko')}까지`],
    ]);
    // no mail promised yet — the mail hook sends nothing
    expect(done.textContent).not.toMatch(/메일/);
    await act(async () => {
      fireEvent.click(within(done).getByTestId('inquiry-start-demo'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const form = screen.getByTestId('demo-form');
    expect((within(form).getByLabelText(/^법인\(사업자\)등록번호/) as HTMLInputElement).value).toBe('123-45-67891');
    expect((within(form).getByLabelText(/^아이디/) as HTMLInputElement).value).toBe('minji@example.com');
    expect((within(form).getByLabelText('비밀번호') as HTMLInputElement).value).toBe('');
    expect(sessionStorage.getItem('solosquad.demoPrefill')).toBeNull();
  });

  it('China: the completion screen names the 统一社会信用代码 and the demo login opens on 중국 with it filled in', async () => {
    stubSite({ inquiry: () => new Response(JSON.stringify({ ok: true, demo: { ...issued, id: 'li@example.cn', company_no: '91350100M000100Y43', company_no_kind: 'uscc' } })) });
    const dialog = await open();
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText(/^나라/), { target: { value: 'cn' } });
    fireEvent.change(within(dialog).getByLabelText(/^통일사회신용코드/), { target: { value: '91350100M000100Y43' } });
    fireEvent.change(within(dialog).getByLabelText(/^휴대전화 번호/), { target: { value: '13800138000' } });
    await send(dialog);
    const done = await screen.findByRole('dialog', { name: '데모 계정이 나왔어요' });
    const account = within(done).getByTestId('inquiry-account');
    expect([...account.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent])[0]).toEqual(['통일사회신용코드', '91350100M000100Y43']);
    await act(async () => {
      fireEvent.click(within(done).getByTestId('inquiry-start-demo'));
    });
    const form = screen.getByTestId('demo-form');
    expect((within(form).getByTestId('demo-country') as HTMLSelectElement).value).toBe('cn');
    expect((within(form).getByLabelText(/^통일사회신용코드/) as HTMLInputElement).value).toBe('91350100M000100Y43');
    expect((within(form).getByLabelText(/^아이디/) as HTMLInputElement).value).toBe('li@example.cn');
  });

  it('a repeat request for the same email says the account was renewed; a call too adds one line', async () => {
    stubSite({ inquiry: () => new Response(JSON.stringify({ ok: true, demo: { ...issued, reused: true } })) });
    const dialog = await open();
    fill(dialog);
    fireEvent.click(within(dialog).getByLabelText('상담'));
    await send(dialog);
    const done = await screen.findByRole('dialog', { name: '데모 계정이 나왔어요' });
    expect(within(done).getByText('이미 있던 데모 계정이에요. 비밀번호와 사용 기간을 새로 맞췄어요. 이 화면을 닫기 전에 적어 두세요.')).toBeTruthy();
    expect(within(done).getByText('상담은 확인하고 연락드릴게요.')).toBeTruthy();
  });

  it.each([
    ['en', 'Apply for a demo account', ['Company name', 'Company registration number', 'Industry', 'Your name', 'Email', 'Phone number'], 'Finance', 'Send request', 'Your demo account is ready', 'Password'],
    ['zh-CN', '申请演示账号', ['公司名称', '企业注册号', '行业', '联系人姓名', '邮箱', '电话号码'], '财务管理', '提交申请', '演示账号已开通', '密码'],
  ] as const)('%s: the fields and the completion screen', async (locale, title, labels, finance, submit, doneTitle, passwordLabel) => {
    stubSite({ inquiry: () => new Response(JSON.stringify({ ok: true, demo: issued })) });
    site('/demo', locale);
    fireEvent.click(screen.getByTestId('demo-apply'));
    const dialog = await screen.findByRole('dialog', { name: title });
    const [company, no, kind, name, email, tel] = labels.map((l) => within(dialog).getByLabelText(new RegExp(`^${l}`)));
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${locale === 'en' ? 'Country' : '国家'}`)), { target: { value: 'kr' } });
    fireEvent.change(company, { target: { value: 'Ace' } });
    fireEvent.change(no, { target: { value: '1234567891' } });
    fireEvent.change(kind, { target: { value: 'retail' } });
    fireEvent.change(name, { target: { value: 'Kim' } });
    fireEvent.change(email, { target: { value: 'kim@example.com' } });
    fireEvent.change(tel, { target: { value: '01012345678' } });
    fireEvent.click(within(dialog).getByLabelText(finance));
    const boxes = dialog.querySelectorAll<HTMLInputElement>('.inquiry-consent input[type="checkbox"]');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: submit }));
    });
    const done = await screen.findByRole('dialog', { name: doneTitle });
    expect(within(done).getByText(passwordLabel)).toBeTruthy();
    expect(within(done).getByText('moon5678')).toBeTruthy();
    expect(done.textContent).not.toMatch(/[가-힣]/);
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
  it.each(['/login', '/login/help', '/demo'])('%s has the compact site footer: 대표, the mailto link and the policy link', (path) => {
    stubSite();
    site(path);
    const footer = screen.getByTestId('site-footer');
    expect(footer.className).toContain('is-compact');
    expect(within(footer).getByText('대표 정승원')).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'contact@toronchul.app' }).getAttribute('href')).toBe('mailto:contact@toronchul.app');
    expect(within(footer).getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy');
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
