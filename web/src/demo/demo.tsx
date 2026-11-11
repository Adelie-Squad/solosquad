// Demo mode on the web (decision 62 · PRD v2.1.0 §3.6.4 · DESIGN.md `### 데모`). Whether this
// is a demo comes from the server (`Me.demo`), never from the address or the client: the
// server enforces the lock table (`403 demo_read_only`) and sends the same table here
// (`demo_info.locked`) so the screen locks the same controls.
import { useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useScopedApi } from '../api/queries';
import type { DemoInfo } from '../api/types.gen';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { isPresent } from '../lib/presence';
import { SessionContext } from '../session';

export interface Demo {
  on: boolean;
  info: DemoInfo | null;
  /** A route key of the lock table (`users.create` …) — locked in this demo. */
  locked: (key: string) => boolean;
}

export function useDemo(): Demo {
  const me = useContext(SessionContext)?.me;
  const on = me?.demo === true;
  const info = me?.demo_info ?? null;
  const set = new Set(info?.locked ?? []);
  return { on, info, locked: (key) => on && set.has(key) };
}

/** Usage events — only a demo server takes them; any failure is silent (never in the way). */
export function demoEvent(body: { kind: 'page_view'; path: string; ms: number } | { kind: 'blocked_click'; name: string } | { kind: 'heartbeat' }) {
  void api.post('/demo/events', body).catch(() => undefined);
}

/** What the visitor looks at (`page_view` — the screen they leave and how long) and a
 * heartbeat while they are there (the session length). Nothing they type is sent. */
export function useDemoUsage(on: boolean) {
  const { pathname } = useLocation();
  const since = useRef<{ path: string; at: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    const prev = since.current;
    if (prev && prev.path !== pathname) demoEvent({ kind: 'page_view', path: prev.path, ms: Date.now() - prev.at });
    if (!prev || prev.path !== pathname) since.current = { path: pathname, at: Date.now() };
  }, [on, pathname]);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      if (isPresent()) demoEvent({ kind: 'heartbeat' });
    }, 60_000);
    const leave = () => {
      const cur = since.current;
      if (cur) demoEvent({ kind: 'page_view', path: cur.path, ms: Date.now() - cur.at });
    };
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', leave);
    };
  }, [on]);
}

/**
 * A locked area: the quiet line "데모에서는 바꿀 수 없어요" above, every control inside disabled
 * (one `fieldset disabled`), and a click on it is counted (`blocked_click` — which setting
 * people are curious about). Outside a demo it renders its children unchanged.
 */
export function DemoLock({ name, children, inline = false }: { name: string; children: ReactNode; inline?: boolean }) {
  const { t } = useI18n();
  const demo = useDemo();
  if (!demo.on) return <>{children}</>;
  return (
    <div className={`demo-lock ${inline ? 'is-inline' : ''}`} data-testid="demo-lock" onPointerDownCapture={() => demoEvent({ kind: 'blocked_click', name })}>
      <p className="demo-lock-note with-icon" role="note">
        <ICON.locked size={14} />
        {t('demo.locked')}
      </p>
      <fieldset className="demo-lock-body" disabled>
        {children}
      </fieldset>
    </div>
  );
}

/** The demo band at the top of the content card: what this is, until when, and the agency. */
export function DemoBand() {
  const { t, fmt } = useI18n();
  const demo = useDemo();
  if (!demo.on || !demo.info) return null;
  return (
    <div className="demo-band" role="note" data-testid="demo-band">
      <span className="chip is-accent">{t('demo.chip')}</span>
      <span className="demo-band-text">{t('demo.band', { date: fmt.date(demo.info.expires) })}</span>
      <span className="demo-band-hint">{t('demo.notice')}</span>
      {demo.info.contact_url && (
        <a className="demo-band-link with-icon" href={demo.info.contact_url} target="_blank" rel="noreferrer">
          {t('demo.contact')}
          <ICON.popout size={14} />
        </a>
      )}
    </div>
  );
}

/** 처음 상태로 — the visitor's copy made again from the template (asks once). */
export function DemoResetButton({ rail = false }: { rail?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const demo = useDemo();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!demo.on) return null;
  return (
    <button
      type="button"
      className="btn is-small with-icon demo-reset"
      disabled={busy}
      aria-label={t('demo.reset')}
      title={rail ? t('demo.reset') : undefined}
      data-testid="demo-reset"
      onClick={async () => {
        if (!window.confirm(t('demo.resetConfirm'))) return;
        setBusy(true);
        try {
          await api.post('/demo/reset', {});
          setDone(true);
          await qc.invalidateQueries();
        } catch {
          setDone(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ICON.reset />
      <span className="demo-reset-text">{busy ? t('common.wait') : done ? t('demo.resetDone') : t('demo.reset')}</span>
    </button>
  );
}

/** 시나리오 다시 시작 (workflows screen) — the open scenario runs stop and all three start again;
 * the copy's history stays (처음 상태로 makes the whole copy again). */
export function DemoRestart() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const demo = useDemo();
  const { ws } = useScopedApi();
  const [busy, setBusy] = useState(false);
  if (!demo.on) return null;
  return (
    <button
      type="button"
      className="btn with-icon"
      disabled={busy}
      data-testid="demo-restart"
      onClick={async () => {
        setBusy(true);
        try {
          await ws.post('/demo/restart', {});
          await qc.invalidateQueries();
        } catch {
          // the scenarios keep running as they were — nothing to undo
        } finally {
          setBusy(false);
        }
      }}
    >
      <ICON.run />
      {busy ? t('common.wait') : t('demo.restart')}
    </button>
  );
}
