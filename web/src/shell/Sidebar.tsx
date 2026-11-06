import { useLinks } from '../scope';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { keys, useApprovals, useThreads } from '../api/queries';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { useOrgOwner } from '../scope';
import { navHref, visibleNav } from './nav';
import { ScopeSwitcher } from './ScopeSwitcher';

/** Sidebar — pinned tiles (2 columns), the conversations, and who is logged in. */
export function Sidebar({ onCommand }: { onCommand: () => void }) {
  const links = useLinks();
  const { w: toWs, o: toOrg } = links;
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const isOwner = useOrgOwner();
  const threads = useThreads();
  const approvals = useApprovals();
  const mine = (approvals.data ?? []).filter((a) => a.can_approve).length;
  // workflow agent steps run on their own company threads; they are not conversations
  const chats = (threads.data ?? []).filter((th) => !th.metadata?.workflow_thread);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="history">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('nav.back')}>
            ←
          </button>
          <button className="icon-btn" onClick={() => navigate(1)} aria-label={t('nav.forward')}>
            →
          </button>
          <button className="icon-btn" onClick={onCommand} aria-label={t('command.open')} title={t('command.open')}>
            ⌘
          </button>
        </div>
      </div>

      <ScopeSwitcher />

      <nav className="pinned" aria-label={t('nav.main')}>
        {visibleNav(isOwner).map((p) => (
          <NavLink key={p.to} to={navHref(p, links)} end={p.to === ''} className="pinned-tile">
            <span className="pinned-icon">{p.icon}</span>
            <span className="pinned-label">{t(p.label)}</span>
            {p.to === '/approvals' && mine > 0 && <span className="pinned-badge">{mine}</span>}
          </NavLink>
        ))}
      </nav>

      <section className="chat-section" aria-label={t('chat.title')}>
        <div className="chat-section-head">
          <span>💬 {t('chat.title')}</span>
          <span className="live-count">{t('chat.count', { n: chats.length })}</span>
        </div>
        <button className="new-request" onClick={() => navigate(toWs('/chat/new'))}>
          + {t('chat.new')}
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
        <NavLink to={toOrg('/settings')} className="viewer-chip" title={t('nav.settings')}>
          <span>{isOwner ? '👑' : '🙂'}</span>
          <span className="viewer-chip-name">{user?.display || user?.username || t('role.local')}</span>
          <span className="viewer-chip-role">{isOwner ? t('role.owner') : t('role.staff')}</span>
        </NavLink>
        <NavLink className="icon-btn" aria-label={t('nav.settings')} title={t('nav.settings')} to={toOrg('/settings')}>
          ⚙️
        </NavLink>
        <button className="icon-btn" aria-label={t('nav.logout')} title={t('nav.logout')} onClick={logout}>
          ⎋
        </button>
      </div>
    </aside>
  );
}
