import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { useLive } from '../live/LiveProvider';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { Sidebar } from './Sidebar';

/**
 * The shell (DESIGN.md `## 레이아웃`): the sidebar on `--bg`, one content card. On a phone the
 * sidebar becomes a drawer behind the menu button.
 */
export function Shell() {
  const { t } = useI18n();
  const live = useLive();
  const [commandOpen, setCommandOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`workspace ${drawer ? 'is-drawer-open' : ''}`}>
      <button className="drawer-toggle icon-btn" aria-label={t('nav.menu')} onClick={() => setDrawer((d) => !d)}>
        <ICON.menu size={20} />
      </button>
      <Sidebar onCommand={() => setCommandOpen(true)} />
      <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden />
      <main className="workspace-card">
        {!live.connected && (
          <div className="viewer-banner" role="status">
            <span>{t('live.reconnecting')}</span>
          </div>
        )}
        <Outlet />
      </main>
      {commandOpen && <CommandBar onClose={() => setCommandOpen(false)} />}
    </div>
  );
}
