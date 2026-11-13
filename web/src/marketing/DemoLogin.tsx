// The demo login (`/demo`, PRD §3.6 · decision 62 · 2026-11-13): one plain form of three fields —
// the company's registration number given in the request (법인(사업자)등록번호, 2026-11-12: the
// number says which company), the ID (the request's email — or an internal ID) and the password —
// posted to this site's Worker (`POST /api/demo/login`, marketing/src/demo.ts), so it works without
// JavaScript. Success → the demo itself at /demo/app; any failure comes back as `?error=1`, one
// sentence for every kind. A country select comes first (2026-11-14 — 한국 by default): for 한국 the
// number field takes digits only and shows hyphens by length (10 → 3-2-5, 13 → 6-7); for 중국 it
// takes the 统一社会信用代码's letters too (upper-cased), for 기타 letters and digits. The Worker
// compares the normalised codes. `?u=` fills the ID (the login router sends the
// code `demo` here); the request modal's completion screen fills the country, the number and the ID (router
// state, else sessionStorage — never the password, never in the address). The request line opens
// the request modal (source demo_login, 데모 계정 pre-checked).
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { codeOf, digitsOf, formatByLength, formatCompanyNo, kindForCountry, MAX_DIGITS, maxDigits } from '../../../marketing/scripts/lib/company-no.mjs';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { DigitsInput } from '../components/DigitsInput';
import { SiteFooter } from './SiteFooter';
import { companyNoLabel, DEMO_PREFILL_KEY, useInquiry, type DemoPrefill } from './Inquiry';

export const DEMO_LOGIN_ACTION = '/api/demo/login';
const MAX_ID = 254;

/** What the completion screen left for this page: router state first, else sessionStorage. */
function takePrefill(state: unknown): Partial<DemoPrefill> {
  let saved: unknown = null;
  try {
    const raw = sessionStorage.getItem(DEMO_PREFILL_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const from = (state && typeof state === 'object' ? state : saved) as Partial<DemoPrefill> | null;
  const country = isCountry(from?.country) ? from.country : undefined;
  return {
    id: typeof from?.id === 'string' ? from.id.slice(0, MAX_ID) : undefined,
    company_no: typeof from?.company_no === 'string' ? (country && country !== 'kr' ? codeOf(from.company_no) : digitsOf(from.company_no)).slice(0, MAX_DIGITS) : undefined,
    country,
  };
}

const COUNTRIES = ['kr', 'cn', 'other'] as const;
type Country = (typeof COUNTRIES)[number];
const isCountry = (c: unknown): c is Country => typeof c === 'string' && (COUNTRIES as readonly string[]).includes(c);
const COUNTRY_NAME: Record<Country, MessageKey> = { kr: 'landing.contact.country.kr', cn: 'landing.contact.country.cn', other: 'landing.contact.country.other' };
const LOGIN_HINT: Record<Country, MessageKey> = { kr: 'demo.login.companyNoHint', cn: 'demo.login.companyNoHint.cn', other: 'demo.login.companyNoHint.other' };

function DemoLoginForm({ prefill }: { prefill: Partial<DemoPrefill> }) {
  const { t } = useI18n();
  const openInquiry = useInquiry();
  const [params] = useSearchParams();
  const failed = params.get('error') === '1';
  const [country, setCountry] = useState<Country>(isCountry(prefill.country) ? prefill.country : 'kr');
  const [number, setNumber] = useState(prefill.company_no ?? '');
  const id = prefill.id ?? (params.get('u') ?? '').slice(0, MAX_ID);
  // a Korean field keeps the digits only
  const pickCountry = (c: string) => {
    const next = isCountry(c) ? c : 'kr';
    setCountry(next);
    setNumber((n) => (next === 'kr' ? digitsOf(n).slice(0, MAX_DIGITS) : n.slice(0, maxDigits(kindForCountry(next)))));
  };

  return (
    <form className="auth-card" method="post" action={DEMO_LOGIN_ACTION} data-testid="demo-form">
      <div className="auth-brand">
        <Mascot size={56} />
        <div>
          <h1>{t('demo.login.title')}</h1>
          <p>{t('demo.login.lead')}</p>
        </div>
      </div>
      <p className="site-demo-note">
        <ICON.explore size={16} aria-hidden="true" />
        {t('demo.login.note')}
      </p>
      {failed && (
        <p className="form-error" role="alert">
          {t('demo.login.failed')}
        </p>
      )}
      {/* the country only shapes the number field (China's code has letters); the Worker compares
          the normalised codes, so it is not sent */}
      <label className="field">
        <span>{t('landing.contact.country')}</span>
        <select value={country} onChange={(e) => pickCountry(e.target.value)} data-testid="demo-country">
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {t(COUNTRY_NAME[c])}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t(companyNoLabel(country))}</span>
        <small>{t(LOGIN_HINT[country])}</small>
        <DigitsInput
          name="company_no"
          placeholder={country === 'kr' ? '123-45-67890' : country === 'cn' ? '91350100M000100Y43' : ''}
          value={number}
          onDigits={setNumber}
          format={country === 'kr' ? formatByLength : (d) => formatCompanyNo(d, kindForCountry(country))}
          max={country === 'kr' ? MAX_DIGITS : maxDigits(kindForCountry(country))}
          letters={country !== 'kr'}
          required
          autoFocus={!prefill.company_no}
        />
      </label>
      <label className="field">
        <span>{t('auth.username')}</span>
        <small>{t('demo.login.idHint')}</small>
        <input name="username" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@company.com" defaultValue={id} maxLength={MAX_ID} required />
      </label>
      <label className="field">
        <span>{t('auth.password')}</span>
        <input name="password" type="password" autoComplete="current-password" required autoFocus={!!prefill.company_no} />
      </label>
      <button className="btn is-primary is-block">{t('demo.login.submit')}</button>
      <button type="button" className="landing-apply-link site-apply" onClick={() => openInquiry({ source: 'demo_login', requests: ['demo'] })} data-testid="demo-apply">
        {t('landing.apply.open')}
      </button>
      <p className="auth-hint">
        <Link to="/login">{t('demo.login.customer')}</Link>
      </p>
      <LocalePicker />
    </form>
  );
}

export function DemoLogin() {
  const location = useLocation();
  // a new arrival (the completion screen's button while already here) starts the form again
  const prefill = useMemo(() => takePrefill(location.state), [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // read once: a later visit starts empty
  useEffect(() => {
    try {
      sessionStorage.removeItem(DEMO_PREFILL_KEY);
    } catch {
      // nothing kept
    }
  }, [location.key]);
  return (
    <div className="auth-page site-auth">
      <DemoLoginForm key={location.key} prefill={prefill} />
      <SiteFooter compact />
    </div>
  );
}
