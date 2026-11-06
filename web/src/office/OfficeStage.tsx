// The office scene on the page: lazy-loads three.js (only this screen pays for it), lays the
// name tags over the canvas, pauses when hidden or scrolled away, and falls back to a list
// when WebGL is missing or fails. The scene is decoration (aria-hidden); the list next to it
// is what a screen reader reads.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { Theme } from '../theme';
import type { SeatAgent } from './layout';
import type { OfficeScene } from './scene';
import type { AgentStatus } from './state';

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

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function isMobile(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth <= 860 || !!window.matchMedia?.('(pointer: coarse)').matches);
}

/** `?webgl=off` forces the list — to check the fallback without breaking a GPU. */
function webglForcedOff(): boolean {
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const tags = useRef(new Map<string, HTMLElement>());
  const [failed, setFailed] = useState(webglForcedOff);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // `?office-debug`: `dispatchEvent(new CustomEvent('solosquad:office-debug', {detail: {chief: 'typing'}}))`
  // overrides statuses by hand — to look at every pose without a live engine
  const [debug, setDebug] = useState<Record<string, AgentStatus>>({});
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('office-debug')) return;
    const on = (e: Event) => setDebug((e as CustomEvent<Record<string, AgentStatus>>).detail ?? {});
    window.addEventListener('solosquad:office-debug', on);
    return () => window.removeEventListener('solosquad:office-debug', on);
  }, []);
  statuses = Object.keys(debug).length ? { ...statuses, ...debug } : statuses;

  // create once: load three.js on demand and build the scene
  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let instance: OfficeScene | null = null;
    import('./scene')
      .then(({ OfficeScene }) => {
        if (cancelled || !canvas.current) return;
        try {
          instance = new OfficeScene(canvas.current, {
            theme,
            reducedMotion: prefersReducedMotion(),
            mobile: isMobile(),
            onSelect: (a) => selectRef.current(a),
          });
        } catch {
          setFailed(true);
          return;
        }
        instance.onFail = () => setFailed(true);
        instance.onHover = (a) => setHovered(a);
        scene.current = instance;
        // `?office-debug` exposes the scene for checking poses and frame rate by hand
        if (new URLSearchParams(window.location.search).has('office-debug')) {
          (window as unknown as { __office?: OfficeScene }).__office = instance;
        }
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      instance?.dispose();
      scene.current = null;
      setReady(false);
    };
    // the scene is built once; theme · agents · statuses flow in through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !ready) return;
    s.setAgents(agents);
    for (const [name, el] of tags.current) s.setTag(name, el);
    s.setStatuses(statuses);
  }, [agents, statuses, ready]);

  useEffect(() => {
    if (ready) scene.current?.setTheme(theme);
  }, [theme, ready]);

  // size, reduced motion, and pausing off-screen
  useEffect(() => {
    const s = scene.current;
    const el = wrap.current;
    if (!s || !ready || !el) return;
    const fit = () => s.resize(el.clientWidth, el.clientHeight);
    fit();
    s.start();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => s.setOnScreen(entries.some((e) => e.isIntersecting)))
        : null;
    io?.observe(el);
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => s.setReducedMotion(!!mq?.matches);
    mq?.addEventListener?.('change', onMotion);
    return () => {
      ro?.disconnect();
      io?.disconnect();
      mq?.removeEventListener?.('change', onMotion);
    };
  }, [ready]);

  if (failed) return <div className="office-fallback">{fallback}</div>;

  return (
    <div className="office-stage" ref={wrap}>
      <canvas ref={canvas} className="office-canvas" aria-hidden="true" />
      <div className="office-tags" aria-hidden="true">
        {agents.map((a) => {
          const st = statuses[a.name] ?? 'idle';
          return (
            <div
              key={a.name}
              className={`office-tag is-${st} ${quiet(st) && a.name !== hovered && a.name !== highlight ? 'is-quiet' : ''}`}
              ref={(el) => {
                if (el) tags.current.set(a.name, el);
                else tags.current.delete(a.name);
                scene.current?.setTag(a.name, el);
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
