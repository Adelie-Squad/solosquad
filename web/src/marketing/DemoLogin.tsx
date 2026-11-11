// The demo login (`/demo`, PRD §3.6 · decision 62): one ID + password form (demo IDs look like
// `samsungDemo`) that the browser posts straight to the demo server — the URL comes from the site
// config (`DEMO_LOGIN_URL`, the engine's demo-mode `POST /api/auth/demo-login`). The marketing site
// never holds or sees a demo password. `?u=` fills the ID (the login router sends the code `demo`
// here). The request line opens the request modal (source demo_login, 데모 계정 pre-checked).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useInquiry } from './Inquiry';
import { siteConfig } from './siteApi';

export function DemoLogin() {
  const { t } = useI18n();
  const openInquiry = useInquiry();
  const [params] = useSearchParams();
  const [action, setAction] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    siteConfig()
      .then((c) => live && setAction(c.demo_login_url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const prefill = (params.get('u') ?? '').slice(0, 120);

  return (
    <div className="auth-page site-auth">
      <form className="auth-card" method="post" action={action ?? undefined} data-testid="demo-form">
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
        <label className="field">
          <span>{t('auth.username')}</span>
          <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="samsungDemo" defaultValue={prefill} required autoFocus={!prefill} />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input name="password" type="password" autoComplete="current-password" required autoFocus={!!prefill} />
        </label>
        <button className="btn is-primary is-block" disabled={!action}>
          {action ? t('demo.login.submit') : t('common.wait')}
        </button>
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
