import { Link } from 'react-router-dom';
import { useMe } from '../api/queries';
import { Mascot } from '../characters/PenguinIcon';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { LOGIN, officeHref, signedIn } from './next';

/**
 * The landing (`/`, outside the shell — DESIGN.md `## 레이아웃` 랜딩): the entrance of this
 * customer's own office server. One section — copy on the left, the plain penguin on the
 * right (one column at 860px and below) — and one button: Log in, or Go to my office when
 * already signed in. It never redirects on its own.
 */
export function Landing() {
  const { t } = useI18n();
  const me = useMe();
  const inside = signedIn(me.data) ? me.data : undefined;
  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="landing-brand">SoloSquad</p>
          <h1 id="landing-title">{t('landing.title')}</h1>
          <p className="landing-lead">{t('landing.lead')}</p>
          {inside ? (
            <Link className="btn is-primary is-large with-icon" to={officeHref(inside)}>
              {t('landing.goOffice')}
              <ICON.forward />
            </Link>
          ) : (
            <Link className="btn is-primary is-large with-icon" to={LOGIN}>
              {t('auth.login')}
              <ICON.forward />
            </Link>
          )}
        </div>
        <div className="landing-visual" aria-hidden>
          <Mascot size={220} />
        </div>
        <div className="landing-locale">
          <LocalePicker />
        </div>
      </section>
    </main>
  );
}
