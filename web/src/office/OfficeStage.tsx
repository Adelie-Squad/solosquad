// The office scene on the page: lazy-loads the 3D chunk (three.js · R3F · drei · the GLBs — only
// this screen pays for it), lays the name tags over the canvas, pauses when hidden or scrolled
// away, and falls back to a list when WebGL is missing or fails. The scene is decoration
// (aria-hidden); the list next to it is what a screen reader reads.
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { Theme } from '../theme';
import type { SeatAgent } from './layout';
import type { AgentStatus } from './state';

const OfficeCanvas = lazy(() => import('./OfficeCanvas'));

export const STATUS_LABEL: Record<AgentStatus, MessageKey> = {
  idle: 'office.status.idle',
  thinking: 'office.status.thinking',
  typing: 'office.status.typing',
  waiting: 'office.status.waiting',
  done: 'office.status.done',
  error: 'office.status.error',
};

export const STATUS_CHIP: Record<AgentStatus, string> = {
  idle: 'is-muted',
  thinking: 'is-quiet',
  typing: 'is-accent',
  waiting: 'is-warn',
  done: 'is-ok',
  error: 'is-danger',
};

/** Idle agents keep their tag hidden until pointed at (scene hover, or the list below) — the
 * working, the waiting, the failed and the just-finished stay readable in a full office. */
export const quiet = (st: AgentStatus) => st === 'idle';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** WebGL at all? (checked before the 3D chunk loads — no point fetching it otherwise) */
export function hasWebGL(): boolean {
  if (typeof window === 'undefined' || (typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined')) return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** A throw while loading or drawing the scene (no context, a bad GLB) — the list takes over. */
class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function isMobile(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth <= 860 || !!window.matchMedia?.('(pointer: coarse)').matches);
}

/** `?webgl=off` forces the list — to check the fallback without breaking a GPU. */
export function webglForcedOff(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('webgl') === 'off';
  } catch {
    return false;
  }
}

export function OfficeStage({
  agents,
  statuses,
  theme,
  onSelect,
  fallback,
  highlight = null,
}: {
  agents: SeatAgent[];
  statuses: Record<string, AgentStatus>;
  theme: Theme;
  onSelect: (agent: string) => void;
  fallback: ReactNode;
  /** An agent pointed at elsewhere (the list below) — its quiet tag shows. */
  highlight?: string | null;
}) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const tags = useRef(new Map<string, HTMLElement>());
  const [failed, setFailed] = useState(() => webglForcedOff() || !hasWebGL());
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile] = useState(isMobile);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [offScreen, setOffScreen] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useCallback((a: string) => selectRef.current(a), []);
  const fail = useCallback(() => setFailed(true), []);
  const onReady = useCallback(() => setReady(true), []);
  // `?office-debug`: `dispatchEvent(new CustomEvent('solosquad:office-debug', {detail: {chief: 'typing'}}))`
  // overrides statuses by hand — to look at every pose without a live engine; `window.__office.fps`
  const debugOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('office-debug');
  const [stats] = useState(() => (debugOn ? { fps: 0 } : undefined));
  const [debug, setDebug] = useState<Record<string, AgentStatus>>({});
  useEffect(() => {
    if (!debugOn) return;
    (window as unknown as { __office?: unknown }).__office = stats;
    const on = (e: Event) => setDebug((e as CustomEvent<Record<string, AgentStatus>>).detail ?? {});
    window.addEventListener('solosquad:office-debug', on);
    return () => window.removeEventListener('solosquad:office-debug', on);
  }, [debugOn, stats]);
  statuses = Object.keys(debug).length ? { ...statuses, ...debug } : statuses;

  // reduced motion, hidden tab and off-screen all stop the loop
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(!!mq?.matches);
    mq?.addEventListener?.('change', onMotion);
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq?.removeEventListener?.('change', onMotion);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  useEffect(() => {
    const el = wrap.current;
    if (!el || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setOffScreen(!entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [failed]);

  if (failed) return <div className="office-fallback">{fallback}</div>;

  return (
    <div className="office-stage" ref={wrap}>
      <SceneBoundary onFail={fail}>
        <Suspense fallback={null}>
          <OfficeCanvas
            agents={agents}
            statuses={statuses}
            theme={theme}
            reducedMotion={reduced}
            mobile={mobile}
            paused={hidden || offScreen}
            tags={tags}
            onSelect={select}
            onHover={setHovered}
            onReady={onReady}
            onFail={fail}
            stats={stats}
          />
        </Suspense>
      </SceneBoundary>
      <div className="office-tags" aria-hidden="true">
        {agents.map((a) => {
          const st = statuses[a.name] ?? 'idle';
          return (
            <div
              key={a.name}
              className={`office-tag is-${st} ${quiet(st) && a.name !== hovered && a.name !== highlight ? 'is-quiet' : ''} ${ready ? '' : 'is-pending'}`}
              ref={(el) => {
                if (el) tags.current.set(a.name, el);
                else tags.current.delete(a.name);
              }}
              title={`${a.label ?? a.name} · ${t(STATUS_LABEL[st])}`}
            >
              <span className="office-tag-pill">
                <span className="office-tag-name">{a.label ?? a.name}</span>
                {st === 'waiting' ? (
                  <span className="office-tag-alert">!</span>
                ) : st === 'error' ? (
                  <span className="office-tag-dot" />
                ) : (
                  <span className={`chip ${STATUS_CHIP[st]}`}>{t(STATUS_LABEL[st])}</span>
                )}
              </span>
              {(st === 'typing' || st === 'thinking') && (
                <span className="office-tag-bar">
                  <span />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!ready && <div className="office-loading">{t('common.loading')}</div>}
    </div>
  );
}
