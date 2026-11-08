// The mascot layer of the landing (DESIGN.md `## 랜딩`): fixed in the scene column of the pinned
// stage for the whole page while the slides change around it; each slide's scene box lies exactly
// over it, so the slide's content sits in front of the penguin. The 2D penguin shows at once; the 3D chunk loads
// after the first paint and takes over only once it has really drawn the penguin (MascotCanvas
// counts draw calls) — if it never does, the page falls back to the 2D penguin. Rendering stops
// when the tab is hidden or the layer is off-screen. Decoration only (aria-hidden).
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Mascot } from '../characters/PenguinIcon';
import type { Theme } from '../theme';
import type { LandingStats, Pointer } from './MascotCanvas';
import type { SectionId } from './sections';

const MascotCanvas = lazy(() => import('./MascotCanvas'));

class Boundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
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

/** After the first paint and when the browser is idle — never in the way of the page itself. */
function afterFirstPaint(run: () => void): () => void {
  let idle: number | undefined;
  const raf = requestAnimationFrame(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 1200 });
    else idle = window.setTimeout(run, 120);
  });
  return () => {
    cancelAnimationFrame(raf);
    const w = window as Window & { cancelIdleCallback?: (id: number) => void };
    if (idle !== undefined) (w.cancelIdleCallback ?? window.clearTimeout)(idle);
  };
}

export function MascotStage({
  section,
  acting,
  theme,
  mobile,
  pointer,
  touch,
  pin,
  onReady: ready3d,
  onFail,
}: {
  section: SectionId;
  /** The penguin acts on the slide's content (Landing: live and drawn). */
  acting: boolean;
  theme: Theme;
  mobile: boolean;
  pointer: RefObject<Pointer | null>;
  touch: boolean;
  /** The pinned stage — the canvas reads the slide's marks (Acts.tsx) from it. */
  pin: RefObject<HTMLElement | null>;
  onReady?: () => void;
  onFail: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [offScreen, setOffScreen] = useState(false);
  const onReady = useCallback(() => {
    setReady(true);
    ready3d?.();
  }, [ready3d]);
  // `?landing-debug`: frames per second at `window.__landing.fps`
  const [stats] = useState<LandingStats | undefined>(() => (new URLSearchParams(window.location.search).has('landing-debug') ? { fps: 0, calls: 0 } : undefined));
  useEffect(() => {
    if (stats) (window as unknown as { __landing?: unknown }).__landing = stats;
  }, [stats]);

  useEffect(() => afterFirstPaint(() => setLoad(true)), []);
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setOffScreen(!entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing-stage" aria-hidden="true">
      <div className={`landing-mascot ${ready ? 'is-ready' : ''}`} ref={wrap} data-testid="landing-mascot">
        <div className="landing-poster">
          <Mascot size={240} />
        </div>
        {load && (
          <Boundary onFail={onFail}>
            <Suspense fallback={null}>
              <MascotCanvas
                act={section}
                acting={acting}
                theme={theme}
                mobile={mobile}
                paused={hidden || offScreen}
                pointer={pointer}
                touch={touch}
                pin={pin}
                onReady={onReady}
                onFail={onFail}
                stats={stats}
              />
            </Suspense>
          </Boundary>
        )}
      </div>
    </div>
  );
}
