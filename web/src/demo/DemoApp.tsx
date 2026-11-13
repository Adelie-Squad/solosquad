// The demo (2026-11-13): the customer web's own screens at /demo/app on the marketing site, run
// against the in-browser engine (engine.ts) through the web's transport seam — no demo server, no
// engine, nothing saved. One demo for everyone: the example company 모아 리빙 and its three scripted
// workflows; the account only adds its company's name (settings → 회사) and its end date (the band).
//
// The marketing Worker lets /demo/app through only with a demo session; this asks it once more
// (`/api/demo/me`) and goes back to the demo login without one. Settings take nothing (언어 · 화면
// stay open), and every screen viewed and button pressed is one usage event. The office pops out
// (2026-11-14) into a window that borrows this window's engine (link.ts) — one demo in two windows,
// never a second, separate one.
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useMe } from '../api/queries';
import { setTransport } from '../api/transport';
import { AppRoutes } from '../App';
import { isLocale, useI18n, type Locale } from '../i18n';
import { ICON } from '../icons';
import { InquiryProvider, useInquiry } from '../marketing/Inquiry';
import '../marketing/messages';
import { SessionContext, sessionFrom } from '../session';
import { SurfaceContext, type Surface } from '../shell/surface';
import { DemoEngine, type DemoData } from './engine';
import { demoEvent, demoLogout, demoSession, viewDetail, DEMO_LOGIN, type DemoSessionInfo } from './session';
import { hostDemo, isPopoutPath, joinDemo, type DemoLink } from './link';
import { demoTransport } from './transport';
import '../styles/HomeView.css';
import '../styles/screens.css';
import '../styles/calendar.css';
import '../styles/view-only.css';
import '../styles/demo.css';

const DATA: Record<Locale, () => Promise<DemoData>> = {
  ko: () => import('./data/ko.json').then((m) => m.default as unknown as DemoData),
  en: () => import('./data/en.json').then((m) => m.default as unknown as DemoData),
  'zh-CN': () => import('./data/zh-CN.json').then((m) => m.default as unknown as DemoData),
};

/** What the demo leaves open: the screen language and theme (this device's). Everything else in
 * settings, and the controls that would change the company, show but take nothing. */
const OPEN = new Set(['settings.language', 'settings.display']);

const STORE_KEY = 'solosquad.locale';
const storedLocale = (): Locale | null => {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
};

const leave = () => window.location.replace(DEMO_LOGIN);

const newQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1 } },
  });

/** The main window runs the engine; the office pop-out borrows it (link.ts). */
export default function DemoApp() {
  const { pathname } = useLocation();
  const [popout] = useState(() => isPopoutPath(pathname));
  return popout ? <DemoPopout /> : <DemoHost />;
}

function DemoHost() {
  const { t, locale, setLocale } = useI18n();
  const [session, setSession] = useState<DemoSessionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [engine, setEngine] = useState<DemoEngine | null>(null);
  const current = useRef<DemoEngine | null>(null);
  const queryClient = useMemo(newQueryClient, []);
  const link = useRef<ReturnType<typeof hostDemo> | null>(null);
  const localeNow = useRef(locale);
  localeNow.current = locale;

  useEffect(() => {
    let live = true;
    demoSession()
      .then((s) => {
        if (!live) return;
        if (!s) return leave();
        // the account's language, unless this device already chose one
        if (!storedLocale() && isLocale(s.locale)) setLocale(s.locale);
        setSession(s);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [setLocale]);

  // the example company in the screen's language — a new language is a fresh demo
  useEffect(() => {
    if (!session) return;
    let live = true;
    DATA[locale]()
      .then((data) => {
        if (!live) return;
        const next = new DemoEngine(data, { demoId: session.demo_id, companyName: session.company_name, expires: endOf(session) });
        next.onAction = (detail) => demoEvent('action', detail);
        current.current?.stop();
        current.current = next;
        setTransport(demoTransport(() => current.current!));
        queryClient.clear();
        setEngine(next);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [session, locale, queryClient]);

  // the office pop-out asks this window's engine; a new engine (처음 상태로 · another language) is
  // the same demo starting over, and the pop-out follows it
  useEffect(() => {
    if (!session || !engine) return;
    if (!link.current) link.current = hostDemo(session.demo_id, () => current.current!, () => localeNow.current);
    else link.current.swap();
  }, [session, engine]);

  useEffect(
    () => () => {
      link.current?.stop();
      link.current = null;
      current.current?.stop();
      setTransport(null);
    },
    [],
  );

  if (failed) return <div className="splash">{t('demo.failed')}</div>;
  if (!session || !engine) return <div className="splash">{t('demo.loading')}</div>;
  return (
    <QueryClientProvider client={queryClient}>
      <InquiryProvider>
        <DemoShell
          key={engine.data.locale + String(engineId(engine))}
          suggestions={engine.data.chat.suggestions}
          session={session}
          onReset={() => setEngine(restart(engine, current, session, queryClient))}
        />
      </InquiryProvider>
    </QueryClientProvider>
  );
}

/** The office pop-out: the same demo as the window that opened it, or a line saying it is gone. */
function DemoPopout() {
  const { t, setLocale } = useI18n();
  const [state, setState] = useState<'wait' | 'on' | 'gone' | 'failed'>('wait');
  const [session, setSession] = useState<DemoSessionInfo | null>(null);
  const [round, setRound] = useState(0);
  const queryClient = useMemo(newQueryClient, []);

  useEffect(() => {
    let live = true;
    let joined: DemoLink | null = null;
    demoSession()
      .then(async (s) => {
        if (!live) return;
        if (!s) return leave();
        const l = await joinDemo(s.demo_id);
        if (!live) return l?.close();
        if (!l) return setState('gone');
        joined = l;
        setTransport(l.transport);
        if (isLocale(l.locale)) setLocale(l.locale);
        l.onReset(() => {
          if (isLocale(l.locale)) setLocale(l.locale);
          queryClient.clear();
          setRound((r) => r + 1);
        });
        l.onGone(() => {
          queryClient.clear();
          setState('gone');
        });
        setSession(s);
        setState('on');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
      joined?.close();
      setTransport(null);
    };
  }, [queryClient, setLocale]);

  if (state === 'failed') return <div className="splash">{t('demo.failed')}</div>;
  if (state === 'gone') return <PopoutGone />;
  if (state === 'wait' || !session) return <div className="splash">{t('demo.loading')}</div>;
  return (
    <QueryClientProvider client={queryClient}>
      <InquiryProvider>
        <DemoShell key={round} suggestions={[]} session={session} />
      </InquiryProvider>
    </QueryClientProvider>
  );
}

/** The opener closed or reloaded: this window does not become a demo of its own. */
function PopoutGone() {
  const { t } = useI18n();
  return (
    <div className="splash demo-popout-gone" role="status" data-testid="demo-popout-gone">
      <p>{t('demo.popoutGone')}</p>
      <div className="demo-popout-actions">
        <button type="button" className="btn is-primary" onClick={() => window.location.assign('/demo/app')}>
          {t('demo.popoutBack')}
        </button>
        <button type="button" className="btn" onClick={() => window.close()}>
          {t('demo.popoutClose')}
        </button>
      </div>
    </div>
  );
}

const ids = new WeakMap<DemoEngine, number>();
let nextId = 0;
const engineId = (e: DemoEngine) => {
  if (!ids.has(e)) ids.set(e, ++nextId);
  return ids.get(e)!;
};

/** 처음 상태로 — the same example company, made again in memory. */
function restart(old: DemoEngine, ref: { current: DemoEngine | null }, session: DemoSessionInfo, qc: QueryClient): DemoEngine {
  old.stop();
  const next = new DemoEngine(old.data, { demoId: session.demo_id, companyName: session.company_name, expires: endOf(session) });
  next.onAction = (detail) => demoEvent('action', detail);
  ref.current = next;
  qc.clear();
  demoEvent('action', 'reset');
  return next;
}

function DemoShell({ suggestions, session, onReset }: { suggestions: string[]; session: DemoSessionInfo; onReset?: () => void }) {
  const { t } = useI18n();
  const surface = useMemo<Surface>(
    () => ({
      banner: <DemoBand expires={session.expires} />,
      ...(onReset ? { sidebarFooter: (rail: boolean) => <ResetButton rail={rail} onReset={onReset} /> } : {}),
      roleTag: t('demo.chip'),
      viewOnly: {
        note: t('demo.locked'),
        locked: (key) => !OPEN.has(key),
        onBlocked: (key) => demoEvent('action', `locked:${key}`),
      },
      suggestions,
    }),
    [suggestions, session.expires, onReset, t],
  );
  return (
    <SurfaceContext.Provider value={surface}>
      <Usage />
      <Routes>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="login" element={<LoggedOut />} />
        <Route path="*" element={<Signed />} />
      </Routes>
    </SurfaceContext.Provider>
  );
}

function Signed() {
  const me = useMe();
  const { t } = useI18n();
  if (!me.data) return <div className="splash">{me.error ? t('demo.failed') : t('demo.loading')}</div>;
  return (
    <SessionContext.Provider value={sessionFrom(me.data)}>
      <AppRoutes />
    </SessionContext.Provider>
  );
}

/** The app's logout lands on its /login: here that is the end of the demo session. */
function LoggedOut() {
  useEffect(() => {
    void demoLogout().then(leave);
  }, []);
  return null;
}

/** Every screen viewed — one event per address (ids left out). */
function Usage() {
  const { pathname } = useLocation();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const detail = viewDetail(pathname);
    if (detail === last.current) return;
    last.current = detail;
    const h = setTimeout(() => demoEvent('view', detail), 800);
    return () => clearTimeout(h);
  }, [pathname]);
  return null;
}

/** The band at the top of the content card: what this is, until when, and the way to us. */
/** The account's end in epoch seconds, or null when it has none. */
const endOf = (s: DemoSessionInfo) => (s.expires ? Date.parse(s.expires) / 1000 : null);

function DemoBand({ expires }: { expires: string | null }) {
  const { t, fmt } = useI18n();
  const openInquiry = useInquiry();
  return (
    <div className="demo-band" role="note" data-testid="demo-band">
      <span className="chip is-accent">{t('demo.chip')}</span>
      <span className="demo-band-text">{expires ? t('demo.band', { date: fmt.date(Date.parse(expires) / 1000) }) : t('demo.bandOpen')}</span>
      <span className="demo-band-hint">{t('demo.notice')}</span>
      <button
        type="button"
        className="demo-band-link with-icon"
        onClick={() => {
          demoEvent('action', 'contact');
          openInquiry({ source: 'demo_app', requests: ['consult'] });
        }}
      >
        {t('demo.contact')}
        <ICON.popout size={14} />
      </button>
    </div>
  );
}

function ResetButton({ rail, onReset }: { rail: boolean; onReset: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="btn is-small with-icon demo-reset"
      aria-label={t('demo.reset')}
      title={rail ? t('demo.reset') : undefined}
      data-testid="demo-reset"
      onClick={() => {
        if (!window.confirm(t('demo.resetConfirm'))) return;
        void qc.cancelQueries();
        onReset();
      }}
    >
      <ICON.reset />
      <span className="demo-reset-text">{t('demo.reset')}</span>
    </button>
  );
}
