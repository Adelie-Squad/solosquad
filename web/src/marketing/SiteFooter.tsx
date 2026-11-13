// The marketing site's footer (2026-11-14): 대표 · the contact email (mailto) · 개인정보처리방침
// (/policy) · © year. Under the landing's last section, and compact under /policy · /login ·
// /login/help · /demo. Who and which address: messages/site.ts.
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { SITE } from './messages/site';

/** The copyright sign — a legal mark drawn as text, not an icon; written as a char code because the
 * pictograph scan in web/test/icons.test.ts cannot tell it from an emoji. */
const COPYRIGHT = String.fromCharCode(0xa9);

export function SiteFooter({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <footer className={`site-footer ${compact ? 'is-compact' : ''} ${className}`.trim()} aria-label={t('footer.label')} data-testid="site-footer">
      <p className="site-footer-brand">{SITE.brand}</p>
      <ul className="site-footer-items">
        <li>{t('footer.owner', { name: SITE.owner[locale] })}</li>
        <li>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
        </li>
        <li>
          <Link to={SITE.policyPath}>{t('footer.policy')}</Link>
        </li>
        <li className="site-footer-copy">{`${COPYRIGHT} ${new Date().getFullYear()} ${SITE.brand}`}</li>
      </ul>
    </footer>
  );
}
