// The demo login (`/demo`, PRD §3.6 · decision 62 · 2026-11-13): one plain form of three fields —
// the company's registration number given in the request (법인(사업자)등록번호, 2026-11-12: the
// number says which company), the ID (the request's email — or an internal ID) and the password —
// posted to this site's Worker (`POST /api/demo/login`, marketing/src/demo.ts), so it works without
// JavaScript. Success → the demo itself at /demo/app; any failure comes back as `?error=1`, one
// sentence for every kind. The number field takes digits only and shows hyphens by length (10 →
// 3-2-5, 13 → 6-7); the Worker compares digits. `?u=` fills the ID (the login router sends the
// code `demo` here); the request modal's completion screen fills the number and the ID (router
// state, else sessionStorage — never the password, never in the address). The request line opens
// the request modal (source demo_login, 데모 계정 pre-checked).
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { formatByLength, MAX_DIGITS } from '../../../marketing/scripts/lib/company-no.mjs';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { DigitsInput } from './DigitsInput';
import { SiteFooter } from './SiteFooter';
import { DEMO_PREFILL_KEY, useInquiry, type DemoPrefill } from './Inquiry';

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
  return {
    id: typeof from?.id === 'string' ? from.id.slice(0, MAX_ID) : undefined,
    company_no: typeof from?.company_no === 'string' ? from.company_no.replace(/\D/g, '').slice(0, MAX_DIGITS) : undefined,
  };
}

function DemoLoginForm({ prefill }: { prefill: Partial<DemoPrefill> }) {
  const { t } = useI18n();
  const openInquiry = useInquiry();
  const [params] = useSearchParams();
  const failed = params.get('error') === '1';
  const [number, setNumber] = useState(prefill.company_no ?? '');
  const id = prefill.id ?? (params.get('u') ?? '').slice(0, MAX_ID);

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
      <label className="field">
        <span>{t('landing.contact.companyNo')}</span>
        <small>{t('demo.login.companyNoHint')}</small>
        <DigitsInput name="company_no" placeholder="123-45-67890" value={number} onDigits={setNumber} format={formatByLength} max={MAX_DIGITS} required autoFocus={!prefill.company_no} />
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
