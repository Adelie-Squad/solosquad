import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useLinks, useOrgOwner } from '../scope';

/**
 * Mail — the place is kept in the menu while the mail connection waits for a decision
 * (2026-11-07). Until then it says so: the owner is pointed at Settings › Connections, staff
 * learn who turns it on. This screen is replaced when mail lands.
 */
export function MailView() {
  const { t } = useI18n();
  const { o: toOrg } = useLinks();
  const isOwner = useOrgOwner();
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('nav.mail')}</h1>
        </div>
      </header>
      <section className="panel empty mail-pending" role="status" data-testid="mail-pending">
        <span className="mail-pending-icon">
          <ICON.mail size={24} />
        </span>
        <h2 className="panel-title">{t('mail.pending')}</h2>
        <p>{isOwner ? t('mail.ownerHint') : t('mail.staffHint')}</p>
        {isOwner && (
          <Link className="btn with-icon" to={toOrg('/settings/connections')}>
            <ICON.connections />
            {t('mail.openConnections')}
          </Link>
        )}
      </section>
    </div>
  );
}
