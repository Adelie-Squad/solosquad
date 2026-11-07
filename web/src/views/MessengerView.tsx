import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useLinks, useOrgOwner } from '../scope';

const CHANNELS = ['gmail', 'kakaotalk', 'slack', 'discord'] as const;

/**
 * Messenger — one place for the channels the company talks through: Gmail, KakaoTalk, Slack
 * and Discord (user, 2026-11-07; it was "mail"). Until the channel connections land it says so:
 * the owner is pointed at Settings › Connections, staff learn who turns it on.
 */
export function MessengerView() {
  const { t } = useI18n();
  const { o: toOrg } = useLinks();
  const isOwner = useOrgOwner();
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('nav.messenger')}</h1>
        </div>
      </header>
      <section className="panel empty messenger-pending" role="status" data-testid="messenger-pending">
        <span className="messenger-pending-icon">
          <ICON.messenger size={24} />
        </span>
        <h2 className="panel-title">{t('messenger.pending')}</h2>
        <ul className="messenger-channels" aria-label={t('messenger.channels')}>
          {CHANNELS.map((c) => (
            <li key={c} className="chip is-quiet">
              {t(`messenger.channel.${c}`)}
            </li>
          ))}
        </ul>
        <p>{isOwner ? t('messenger.ownerHint') : t('messenger.staffHint')}</p>
        {isOwner && (
          <Link className="btn with-icon" to={toOrg('/settings/connections')}>
            <ICON.connections />
            {t('messenger.openConnections')}
          </Link>
        )}
      </section>
    </div>
  );
}
