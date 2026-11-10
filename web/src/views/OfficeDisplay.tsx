// The office in a window of its own (`…/office/display`, DESIGN.md `## 사무실 장면` — 새 창):
// the scene and the live work, nothing else — no sidebar, no page header, no org chart. Made to
// sit full screen on a second monitor while the person keeps working in the main window.
//
// It is the same app at another address, so it has its own event stream and its own queries:
// whatever happens in the main window reaches it the way it reaches any screen — the server's
// events — and a change made there also nudges it to ask again at once (DATA_CHANNEL).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { keys } from '../api/queries';
import { JobList } from '../components/JobList';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { DATA_CHANNEL, openChannel } from '../lib/channels';
import { OfficeStage, zoomKey } from '../office/OfficeStage';
import { usePopoutBeacon } from '../office/popout';
import { findOrg, findWorkspace, useScope } from '../scope';
import { useSession } from '../session';
import { useTheme } from '../theme';
import { AgentRoster, OfficeStats, useOfficeState } from './OfficeView';

/** Full screen on and off for this window (the Fullscreen API; Esc leaves it as well). */
function useFullscreen(): { on: boolean; toggle: () => void; supported: boolean } {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const supported = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return { on, toggle, supported };
}

export function OfficeDisplay() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const qc = useQueryClient();
  const { org, ws } = useScope();
  const { me } = useSession();
  const { agents, list, pending, statuses, seats, jobs, doneToday, running } = useOfficeState();
  const fullscreen = useFullscreen();
  usePopoutBeacon(org, ws);

  const orgName = findOrg(me.scopes, org)?.display || org;
  const wsName = findWorkspace(me.scopes, org, ws)?.display || ws;
  const title = t('office.displayTitle', { org: orgName, ws: wsName });
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);

  // a change made in another window: ask again now rather than at the server's event
  useEffect(() => {
    const ch = openChannel(DATA_CHANNEL);
    if (!ch) return;
    const onMessage = () => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
    ch.addEventListener('message', onMessage);
    return () => {
      ch.removeEventListener('message', onMessage);
      ch.close();
    };
  }, [qc]);

  // nobody clicks in a display window, so focus refetches never come: check the session now and then
  useEffect(() => {
    const id = window.setInterval(() => void qc.invalidateQueries({ queryKey: keys.me }), 60_000);
    return () => window.clearInterval(id);
  }, [qc]);

  if (agents.isPending) return <div className="office-display"><Loading /></div>;
  if (agents.error) return <div className="office-display"><QueryError error={agents.error} /></div>;

  const roster = <AgentRoster agents={list} statuses={statuses} onSelect={() => {}} />;

  return (
    <main className="office-display" aria-label={title}>
      <section className="office-display-scene">
        {/* the same controls as the office screen; the zoom is remembered apart from it */}
        <OfficeStage agents={seats} statuses={statuses} theme={theme} onSelect={() => {}} fallback={roster} display storageKey={zoomKey(org, ws, true)} />
        <div className="office-display-top">
        <header className="office-display-overlay">
          <h1>{t('office.title')}</h1>
          <OfficeStats running={running} waiting={pending.length} doneToday={doneToday} />
        </header>
        {fullscreen.supported && (
          <button
            className="btn with-icon office-display-fs"
            onClick={fullscreen.toggle}
          >
            {fullscreen.on ? <ICON.exitFullscreen /> : <ICON.fullscreen />}
            {fullscreen.on ? t('office.exitFullscreen') : t('office.fullscreen')}
          </button>
        )}
        </div>
      </section>
      <aside className="office-live" aria-label={t('office.live')}>
        <header className="office-live-head">
          <strong>
            <span className="live-dot btn-dot" /> {t('office.live')}
          </strong>
          <span className="office-live-count">{t('office.liveCount', { running, queued: jobs.length - running })}</span>
        </header>
        <JobList jobs={jobs} compact />
      </aside>
    </main>
  );
}
