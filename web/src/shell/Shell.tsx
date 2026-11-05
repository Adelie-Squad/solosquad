import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { useLive } from '../live/LiveProvider';
import { useI18n } from '../i18n';
import { theme } from '../theme';
import { Sidebar } from './Sidebar';

/**
 * The shell — the prototype's Arc layout (DESIGN.md): one gradient behind everything, a
 * translucent sidebar on the left, one white card for the content. On a phone the sidebar
 * becomes a drawer behind the ☰ button.
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
    <div
      className={`workspace ${drawer ? 'is-drawer-open' : ''}`}
      style={{ background: theme.gradient, ['--accent' as string]: theme.accent }}
    >
      <button className="drawer-toggle icon-btn" aria-label={t('nav.menu')} onClick={() => setDrawer((d) => !d)}>
        ☰
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
