import { useLinks } from '../scope';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApprovals, useArtifacts, useThreads } from '../api/queries';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useSession } from '../session';
import { useOrgOwner } from '../scope';
import { navActive, navHref, visibleNav } from './nav';
import { ScopeSwitcher } from './ScopeSwitcher';

/** Sidebar — pinned tiles (2 columns), the conversations, and who is logged in. */
export function Sidebar({ onCommand }: { onCommand: () => void }) {
  const links = useLinks();
  const { w: toWs, o: toOrg } = links;
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const { user } = useSession();
  const isOwner = useOrgOwner();
  const threads = useThreads();
  const approvals = useApprovals();
  const reviews = useArtifacts({ needs_review: true, limit: 50 });
  const { pathname } = useLocation();
  // Task's badge = what waits for this person: cards they may answer + work products to check
  const todo = (approvals.data ?? []).filter((a) => a.can_approve).length + (reviews.data ?? []).length;
  // workflow agent steps run on their own company threads; they are not conversations
  const chats = (threads.data ?? []).filter((th) => !th.metadata?.workflow_thread);
  const name = user?.display || user?.username || t('role.local');
  const role = isOwner ? t('role.owner') : t('role.staff');

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="history">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('nav.back')} title={t('nav.back')}>
            <ICON.back />
          </button>
          <button className="icon-btn" onClick={() => navigate(1)} aria-label={t('nav.forward')} title={t('nav.forward')}>
            <ICON.forward />
          </button>
          <button className="icon-btn" onClick={onCommand} aria-label={t('command.open')} title={t('command.open')}>
            <ICON.command />
          </button>
        </div>
      </div>

      <ScopeSwitcher />

      <nav className="pinned" aria-label={t('nav.main')}>
        {visibleNav(isOwner).map((p) => {
          const active = navActive(p, pathname, links);
          return (
            <Link key={p.to} to={navHref(p, links)} className={`pinned-tile ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
              <p.icon className="pinned-icon" size={18} />
              <span className="pinned-label" title={t(p.label)}>
                {t(p.label)}
              </span>
              {p.to === '/tasks' && todo > 0 && (
                <span className="pinned-badge" aria-label={t('nav.todoBadge', { n: todo })}>
                  {todo}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <section className="chat-section" aria-label={t('chat.title')}>
        <div className="chat-section-head">
          <span className="with-icon">
            <ICON.chat />
            {t('chat.title')}
          </span>
          <span className="live-count">{t('chat.count', { n: chats.length })}</span>
        </div>
        <button className="new-request with-icon" onClick={() => navigate(toWs('/chat/new'))}>
          <ICON.new />
          {t('chat.new')}
        </button>
        <ul className="session-list">
          {chats.map((s) => (
            <li key={s.id}>
              <NavLink to={toWs(`/chat/${s.id}`)} className="session-item">
                <span className="session-title">{s.title || t('chat.untitled')}</span>
                <span className="session-meta">{fmt.relative(s.updated)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </section>

      <div className="sidebar-bottom">
        {/* one control for "who is here" and settings — one hit target, one focus stop (2026-11-08) */}
        <NavLink to={toOrg('/settings')} className="account-button" aria-label={t('nav.account', { name, role })} title={t('nav.account', { name, role })}>
          {isOwner ? <ICON.owner className="account-button-icon" /> : <ICON.person className="account-button-icon" />}
          <span className="account-button-text">
            <span className="account-button-name">{name}</span>
            <span className="account-button-role">{role}</span>
          </span>
          <ICON.settings className="account-button-settings" />
        </NavLink>
      </div>
    </aside>
  );
}
