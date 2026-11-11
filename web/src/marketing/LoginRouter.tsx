// The marketing login (`/login`, PRD §3.6.2 · DM5): company code + ID → 다음. A plain form post to
// `POST /api/login/route` — it works without JavaScript — answered with a 303 to that company
// server's login (the ID filled in), to the demo login for the code `demo`, or to the neutral
// `/login/help`. No password here. The company code is remembered on this device (local storage).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';

const REMEMBER = 'solosquad.companyCode';

const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER) ?? '';
  } catch {
    return '';
  }
};

export function LoginRouter() {
  const { t } = useI18n();
  const [code, setCode] = useState(remembered);
  const remember = () => {
    try {
      const c = code.trim().toLowerCase();
      if (c) localStorage.setItem(REMEMBER, c);
    } catch {
      // storage may be blocked; the form still goes
    }
  };

  return (
    <div className="auth-page site-auth">
      <form className="auth-card" method="post" action="/api/login/route" onSubmit={remember} data-testid="router-form">
        <div className="auth-brand">
          <Mascot size={56} />
          <div>
            <h1>{t('login.router.title')}</h1>
          </div>
        </div>
        <label className="field">
          <span>{t('login.router.code')}</span>
          <small id="router-code-hint">{t('login.router.code.hint')}</small>
          <input
            name="code"
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="router-code-hint"
            pattern="[A-Za-z0-9]{3,20}"
            maxLength={20}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus={!code}
          />
        </label>
        <label className="field">
          <span>{t('login.router.id')}</span>
          <input name="id" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={120} required autoFocus={!!code} />
        </label>
        <button className="btn is-primary is-block">{t('login.router.next')}</button>
        <p className="auth-hint">{t('login.router.code.help')}</p>
        <p className="auth-hint">
          {t('login.router.demo')} <Link to="/demo">{t('login.router.demoLink')}</Link>
        </p>
        <LocalePicker />
      </form>
    </div>
  );
}

/** `/login/help` — the one neutral page for every code the router cannot send on (unknown,
 * suspended, malformed, over the limit). It never says that something does not exist. */
export function LoginHelp() {
  const { t } = useI18n();
  return (
    <div className="auth-page site-auth">
      <div className="auth-card" data-testid="router-help">
        <div className="auth-brand">
          <Mascot size={56} />
          <div>
            <h1>{t('login.help.title')}</h1>
          </div>
        </div>
        <p className="site-auth-body">{t('login.help.body')}</p>
        <Link className="btn is-primary is-block" to="/login" autoFocus>
          {t('login.help.retry')}
        </Link>
        <p className="auth-hint">
          {t('login.router.demo')} <Link to="/demo">{t('login.router.demoLink')}</Link>
        </p>
      </div>
    </div>
  );
}
