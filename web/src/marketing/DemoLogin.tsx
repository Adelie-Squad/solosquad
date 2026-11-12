// The demo login (`/demo`, PRD §3.6 · decision 62 · 2026-11-13): one plain form of three fields —
// the company's registration number given in the request (법인(사업자)등록번호, 2026-11-12: the
// number says which company), the ID (demo IDs look like `samsungDemo`) and the password — posted
// to this site's Worker (`POST /api/demo/login`, marketing/src/demo.ts), so it works without
// JavaScript. Success → the demo itself at /demo/app; any failure comes back as `?error=1`, one
// sentence for every kind. `?u=` fills the ID (the login router sends the code `demo` here). The
// request line opens the request modal (source demo_login, 데모 계정 pre-checked).
import { Link, useSearchParams } from 'react-router-dom';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useInquiry } from './Inquiry';

export const DEMO_LOGIN_ACTION = '/api/demo/login';

export function DemoLogin() {
  const { t } = useI18n();
  const openInquiry = useInquiry();
  const [params] = useSearchParams();
  const prefill = (params.get('u') ?? '').slice(0, 120);
  const failed = params.get('error') === '1';

  return (
    <div className="auth-page site-auth">
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
          <input name="company_no" autoComplete="off" spellCheck={false} placeholder="123-45-67890" maxLength={40} required autoFocus />
        </label>
        <label className="field">
          <span>{t('auth.username')}</span>
          <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="samsungDemo" defaultValue={prefill} maxLength={40} required />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input name="password" type="password" autoComplete="current-password" required />
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
    </div>
  );
}
