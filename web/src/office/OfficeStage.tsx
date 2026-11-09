// The office scene on the page: lazy-loads the 3D chunk (three.js · R3F · drei · the GLBs — only
// this screen pays for it), lays the name tags and team labels over the canvas, owns the zoom
// (five levels, buttons, keys, wheel, drag, pinch — zoom.ts), pauses when hidden or scrolled
// away, and falls back to a list when WebGL is missing or fails. The scene is decoration
// (aria-hidden); the list next to it is what a screen reader reads.
import { Component, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { teamName } from '../lib/names';
import type { Theme } from '../theme';
import type { SeatAgent } from './layout';
import type { AgentStatus } from './state';
import { DRAG_PX } from './clicks';
import { LEVELS, tagPriority, tagsShowAll, wheelFactor, wheelKind, WheelStepper, ZoomController } from './zoom';

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

/** Does this tag show? From L3 every tag does (the penguins are far enough apart); at L1–L2 an
 * idle agent's only when pointed at. */
export function tagShown(st: AgentStatus, level: number, pointed: boolean): boolean {
  return tagsShowAll(level) || pointed || !quiet(st);
}

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

/** What the page around the scene can ask of it. */
export interface OfficeStageApi {
  /** Zoom to L5 on that agent's desk ("이 에이전트로 확대"). */
  focusAgent: (agent: string) => void;
}

/** Where a stage remembers its zoom: one per workspace, the pop-out its own. */
export const zoomKey = (org: string, ws: string, display = false) => `solosquad.office.${display ? 'display-zoom' : 'zoom'}.${org}/${ws}`;

type PodInfo = { key: string; team: string | null; chief: boolean };

export function OfficeStage({
  agents,
  statuses,
  theme,
  onSelect,
  fallback,
  highlight = null,
  paused = false,
  display = false,
  storageKey,
  onZoomable,
  ref,
}: {
  agents: SeatAgent[];
  statuses: Record<string, AgentStatus>;
  theme: Theme;
  onSelect: (agent: string) => void;
  fallback: ReactNode;
  /** An agent pointed at elsewhere (the list below) — its quiet tag shows. */
  highlight?: string | null;
  /** Stop drawing (the scene is shown in the pop-out window instead). */
  paused?: boolean;
  /** The pop-out window: no page to scroll, so one finger pans at L1 too (`touch-action: none`). */
  display?: boolean;
  /** localStorage key for the level and centre (`zoomKey`). */
  storageKey?: string;
  /** The scene is up and can zoom (false while loading, or with the fallback list). */
  onZoomable?: (can: boolean) => void;
  ref?: Ref<OfficeStageApi>;
}) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const tags = useRef(new Map<string, HTMLElement>());
  const teamTags = useRef(new Map<string, HTMLElement>());
  const [failed, setFailed] = useState(() => webglForcedOff() || !hasWebGL());
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [mobile] = useState(isMobile);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [offScreen, setOffScreen] = useState(false);
  const [pods, setPods] = useState<PodInfo[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useCallback((a: string) => selectRef.current(a), []);
  const fail = useCallback(() => setFailed(true), []);
  const onReady = useCallback(() => setReady(true), []);
  const onPods = useCallback((p: PodInfo[]) => setPods(p), []);

  // the camera's level and centre — one controller per stage (and per workspace)
  const zoom = useMemo(() => new ZoomController(storageKey), [storageKey]);
  useEffect(() => () => zoom.dispose(), [zoom]);
  zoom.reduced = reduced;
  const [level, setLevel] = useState(() => zoom.level());
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    setLevel(zoom.level());
    return zoom.subscribe((e) => {
      if (e === 'level') setLevel(zoom.level());
      if (e === 'settle') setAnnounce(tRef.current('office.zoom.level', { n: zoom.level(), total: LEVELS }));
    });
  }, [zoom]);
  useImperativeHandle(ref, () => ({ focusAgent: (agent: string) => void zoom.focusAgent(agent) }), [zoom]);
  const zoomable = ready && !failed;
  useEffect(() => {
    onZoomable?.(zoomable);
  }, [zoomable, onZoomable]);

  // `?office-debug`: `dispatchEvent(new CustomEvent('solosquad:office-debug', {detail: {chief: 'typing'}}))`
  // overrides statuses by hand — to look at every pose without a live engine; `window.__office.fps`
  const debugOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('office-debug');
  const [stats] = useState(() => (debugOn ? { fps: 0 } : undefined));
  const [debug, setDebug] = useState<Record<string, AgentStatus>>({});
  useEffect(() => {
    if (!debugOn) return;
    (window as unknown as { __office?: unknown }).__office = Object.assign(stats ?? {}, { zoom });
    const on = (e: Event) => setDebug((e as CustomEvent<Record<string, AgentStatus>>).detail ?? {});
    window.addEventListener('solosquad:office-debug', on);
    return () => window.removeEventListener('solosquad:office-debug', on);
  }, [debugOn, stats, zoom]);
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

  // wheel · pinch · drag — native listeners on the stage (a React wheel handler is passive and
  // cannot stop the page). The stage is the same node in a full-screen window, so they hold there.
  useEffect(() => {
    const el = wrap.current;
    if (!el || failed) return;
    const local = (x: number, y: number) => {
      const r = (el.querySelector('canvas') ?? el).getBoundingClientRect();
      return [x - r.left, y - r.top] as const;
    };
    // every wheel over the scene zooms — and only over it, so the page scrolls elsewhere
    const stepper = new WheelStepper();
    let lastWheel = -Infinity;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = e.timeStamp || performance.now();
      const kind = wheelKind(e as WheelEvent & { wheelDeltaY?: number }, now - lastWheel);
      lastWheel = now;
      const [px, py] = local(e.clientX, e.clientY);
      if (kind === 'pinch') {
        stepper.push(e, kind, now);
        zoom.zoomAt(wheelFactor(e), px, py);
        return;
      }
      const dir = stepper.push(e, kind, now);
      if (dir) zoom.stepAt(dir, px, py);
    };
    // Safari's trackpad pinch comes as gesture events, not ctrl+wheel
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      e.preventDefault();
      zoom.zoomAt(g.scale / gestureScale, ...local(g.clientX, g.clientY));
      gestureScale = g.scale;
    };
    // one pointer drags, two pinch. A drag starts anywhere on the scene — the canvas, a penguin,
    // a team label — except the zoom buttons; it pans once the pointer travels DRAG_PX, and the
    // click that ends it is swallowed (no agent modal, no team zoom). At L1 the room follows
    // with resistance and springs back (dragBy) — the whole office is already in view.
    const down = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let panning = false;
    let swallowClick = false;
    let pinch: { d: number; x: number; y: number } | null = null;
    const pinchOf = () => {
      const [a, b] = [...down.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as HTMLElement).closest?.('.office-zoom')) return;
      swallowClick = false;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (down.size === 2) {
        pinch = pinchOf();
        if (panning) zoom.endDrag();
        panning = false;
      } else if (down.size === 1) start = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      const prev = down.get(e.pointerId);
      if (!prev) return;
      const p = { x: e.clientX, y: e.clientY };
      down.set(e.pointerId, p);
      if (down.size >= 2 && pinch) {
        const now = pinchOf();
        if (pinch.d > 0) zoom.zoomAt(now.d / pinch.d, ...local(now.x, now.y));
        zoom.panBy(now.x - pinch.x, now.y - pinch.y);
        pinch = now;
        return;
      }
      if (!panning && start && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_PX) {
        panning = true;
        swallowClick = true;
        setDragging(true);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // a synthetic pointer — the drag still works without capture
        }
        zoom.dragBy(p.x - start.x, p.y - start.y); // the travel up to the threshold counts too
        return;
      }
      if (panning) {
        e.preventDefault();
        zoom.dragBy(p.x - prev.x, p.y - prev.y);
      }
    };
    const onUp = (e: PointerEvent) => {
      down.delete(e.pointerId);
      if (down.size < 2) pinch = null;
      if (down.size === 0) {
        start = null;
        if (panning) {
          setDragging(false);
          zoom.endDrag();
        }
        panning = false;
      }
    };
    // the click at the end of a drag is not a click (capture: before the canvas or a label sees it)
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDblClick = (e: MouseEvent) => {
      if (panning || swallowClick) e.stopPropagation();
    };
    el.addEventListener('click', onClick, true);
    el.addEventListener('dblclick', onDblClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dblclick', onDblClick, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [zoom, failed]);

  /** `+` / `-` (and arrows to pan, once zoomed) while the scene has focus; `0` — back to the whole office — is a hidden shortcut. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘+ / ctrl+ stay the browser's zoom
    const k = e.key;
    if (k === '+' || k === '=') zoom.stepIn();
    else if (k === '-' || k === '_') zoom.stepOut();
    else if (k === '0') zoom.fit();
    else if (k.startsWith('Arrow') && zoom.zoomed()) {
      const d = 60;
      zoom.panBy(k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0, k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0);
    } else return;
    e.preventDefault();
  };

  if (failed) return <div className="office-fallback">{fallback}</div>;

  const teams = pods.filter((p) => !p.chief && p.team);
  return (
    <div
      className={`office-stage ${level > 1 ? 'is-zoomed' : ''} ${dragging ? 'is-dragging' : ''} ${display ? 'is-display' : ''}`}
      ref={wrap}
      tabIndex={zoomable ? 0 : undefined}
      role={zoomable ? 'group' : undefined}
      aria-label={zoomable ? t('office.zoom.scene') : undefined}
      aria-keyshortcuts={zoomable ? '+ -' : undefined}
      onKeyDown={zoomable ? onKeyDown : undefined}
    >
      <SceneBoundary onFail={fail}>
        <Suspense fallback={null}>
          <OfficeCanvas
            agents={agents}
            statuses={statuses}
            theme={theme}
            reducedMotion={reduced}
            mobile={mobile}
            paused={paused || hidden || offScreen}
            tags={tags}
            teamTags={teamTags}
            zoom={zoom}
            onSelect={select}
            onHover={setHovered}
            onPods={onPods}
            onReady={onReady}
            onFail={fail}
            stats={stats}
          />
        </Suspense>
      </SceneBoundary>
      {/* team labels — a click zooms to that team (the deepest level that still frames its pod) */}
      <div className={`office-teams ${ready && level < LEVELS ? '' : 'is-hidden'}`}>
        {teams.map((p) => {
          const name = teamName(p.team!, t);
          return (
            <button
              key={p.key}
              type="button"
              className="office-team-label"
              ref={(el) => {
                if (el) teamTags.current.set(p.key, el);
                else teamTags.current.delete(p.key);
              }}
              aria-label={t('office.zoom.toTeam', { team: name })}
              title={t('office.zoom.toTeam', { team: name })}
              onClick={() => zoom.focusTeam(p.key)}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="office-tags" aria-hidden="true">
        {agents.map((a) => {
          const st = statuses[a.name] ?? 'idle';
          const pointed = a.name === hovered || a.name === highlight;
          return (
            <div
              key={a.name}
              className={`office-tag is-${st} ${tagShown(st, level, pointed) ? '' : 'is-quiet'} ${ready ? '' : 'is-pending'}`}
              data-prio={tagPriority(st, pointed)}
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
      {zoomable && <ZoomControls zoom={zoom} level={level} />}
      <p className="office-zoom-live" aria-live="polite">
        {announce}
      </p>
      {!ready && <div className="office-loading">{t('common.loading')}</div>}
    </div>
  );
}

/** − · + on the scene's corner (user 2026-11-10: no level dots, no 전체 보기 button). */
function ZoomControls({ zoom, level }: { zoom: ZoomController; level: number }) {
  const { t } = useI18n();
  return (
    <div className="office-zoom" role="toolbar" aria-label={t('office.zoom.controls')}>
      <button type="button" className="office-zoom-btn" aria-label={t('office.zoom.out')} title={`${t('office.zoom.out')} (-)`} disabled={level <= 1 && !zoom.zoomed()} onClick={() => zoom.stepOut()}>
        <ICON.zoomOut />
      </button>
      <button type="button" className="office-zoom-btn" aria-label={t('office.zoom.in')} title={`${t('office.zoom.in')} (+)`} disabled={level >= LEVELS} onClick={() => zoom.stepIn()}>
        <ICON.zoomIn />
      </button>
    </div>
  );
}
