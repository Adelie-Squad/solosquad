import { useLinks } from '../scope';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApprovals, useArtifacts, useThreads } from '../api/queries';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useSession } from '../session';
import { useOrgOwner } from '../scope';
import { ACCOUNT_NAV, navActive, navHref, visibleNav, WORKSPACE_NAV, type NavItem } from './nav';
import { ScopeSwitcher } from './ScopeSwitcher';
import { DemoResetButton, useDemo } from '../demo/demo';

/** Sidebar — two groups of tiles (2 columns), the conversations, and who is logged in. Folded
 * (`rail`), it is a column of icons — each keeps its name as `aria-label` and a tooltip. */
export function Sidebar({ onCommand, rail = false, onToggleRail }: { onCommand: () => void; rail?: boolean; onToggleRail?: () => void }) {
  const { w: toWs, o: toOrg } = useLinks();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const { user } = useSession();
  const demo = useDemo();
  const isOwner = useOrgOwner();
  const threads = useThreads();
  const approvals = useApprovals();
  const reviews = useArtifacts({ needs_review: true, limit: 50 });
  // Task's badge = what waits for this person: cards they may answer + work products to check
  const todo = (approvals.data ?? []).filter((a) => a.can_approve).length + (reviews.data ?? []).length;
  // workflow agent steps run on their own company threads; they are not conversations
  const chats = (threads.data ?? []).filter((th) => !th.metadata?.workflow_thread);
  const name = user?.display || user?.username || t('role.local');
  const role = isOwner ? t('role.owner') : t('role.staff');
  const label = demo.on ? `${role} · ${t('demo.chip')}` : role;

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
        {onToggleRail && (
          <button
            className="icon-btn sidebar-collapse"
            onClick={onToggleRail}
            aria-label={rail ? t('nav.expand') : t('nav.collapse')}
            aria-expanded={!rail}
            title={`${rail ? t('nav.expand') : t('nav.collapse')} (${t('nav.railShortcut')})`}
            data-testid="sidebar-toggle"
          >
            {rail ? <ICON.expandSidebar size={18} /> : <ICON.collapseSidebar size={18} />}
          </button>
        )}
      </div>

      {/* the whole account (decision 60): dashboard · calendar · messenger */}
      <nav className="pinned is-account" aria-label={t('nav.accountGroup')}>
        {visibleNav(isOwner, ACCOUNT_NAV).map((p) => (
          <Tile key={p.to} item={p} rail={rail} />
        ))}
      </nav>

      <div className="sidebar-divider" role="separator" />

      {/* the workspace in the switcher: office · Tasks · workflows */}
      <ScopeSwitcher compact={rail} />
      <nav className="pinned" aria-label={t('nav.workspaceGroup')}>
        {visibleNav(isOwner, WORKSPACE_NAV).map((p) => (
          <Tile key={p.to} item={p} badge={p.to === '/tasks' ? todo : 0} rail={rail} />
        ))}
      </nav>

      <section className="chat-section" aria-label={t('chat.title')}>
        <div className="chat-section-head">
          <span className="with-icon">
            <ICON.chat />
            {t('chat.title')}
          </span>
          <span className="live-count">{t('chat.count', { n: chats.length })}</span>
        </div>
        <button className="new-request with-icon" onClick={() => navigate(toWs('/chat/new'))} title={rail ? t('chat.new') : undefined}>
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
        <DemoResetButton rail={rail} />
        {/* one control for "who is here" and settings — one hit target, one focus stop (2026-11-08) */}
        <NavLink to={toOrg('/settings')} className="account-button" aria-label={t('nav.account', { name, role: label })} title={t('nav.account', { name, role: label })}>
          {isOwner ? <ICON.owner className="account-button-icon" /> : <ICON.person className="account-button-icon" />}
          <span className="account-button-text">
            <span className="account-button-name">{name}</span>
            <span className="account-button-role">
              {role}
              {demo.on && (
                <span className="chip is-accent demo-chip" data-testid="demo-chip">
                  {t('demo.chip')}
                </span>
              )}
            </span>
          </span>
          <ICON.settings className="account-button-settings" />
        </NavLink>
      </div>
    </aside>
  );
}

function Tile({ item: p, badge = 0, rail = false }: { item: NavItem; badge?: number; rail?: boolean }) {
  const links = useLinks();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const active = navActive(p, pathname, links);
  return (
    <Link
      to={navHref(p, links)}
      className={`pinned-tile ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={rail ? (badge > 0 ? `${t(p.label)} · ${t('nav.todoBadge', { n: badge })}` : t(p.label)) : undefined}
      title={rail ? t(p.label) : undefined}
    >
      <p.icon className="pinned-icon" size={18} />
      <span className="pinned-label" title={t(p.label)}>
        {t(p.label)}
      </span>
      {badge > 0 && (
        <span className="pinned-badge" aria-label={t('nav.todoBadge', { n: badge })}>
          {badge}
        </span>
      )}
    </Link>
  );
}
