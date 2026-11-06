// The mascot layer of the landing (DESIGN.md `## 랜딩`): sticky in the middle of the viewport
// while the sections scroll past. The 2D penguin shows at once; the 3D chunk loads after the
// first paint and takes over when it has drawn. Rendering stops when the tab is hidden or the
// layer is off-screen. Decoration only (aria-hidden).
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Mascot } from '../characters/PenguinIcon';
import type { ClipName } from '../office/contract';
import type { Theme } from '../theme';
import type { Pointer } from './MascotCanvas';
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
  clip,
  theme,
  mobile,
  pointer,
  scroll,
  onFail,
}: {
  section: SectionId;
  clip: ClipName;
  theme: Theme;
  mobile: boolean;
  pointer: RefObject<Pointer>;
  scroll: RefObject<number>;
  onFail: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [offScreen, setOffScreen] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  // `?landing-debug`: frames per second at `window.__landing.fps`
  const [stats] = useState(() => (new URLSearchParams(window.location.search).has('landing-debug') ? { fps: 0 } : undefined));
  useEffect(() => {
    if (stats) (window as unknown as { __landing?: unknown }).__landing = stats;
  }, [stats]);
  // greet only when the page opens at the top
  const [greet] = useState(() => section === 'hero');

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
      <div className={`landing-mascot is-${section} ${ready ? 'is-ready' : ''}`} ref={wrap} data-clip={clip}>
        <div className="landing-poster">
          <Mascot size={240} />
        </div>
        {load && (
          <Boundary onFail={onFail}>
            <Suspense fallback={null}>
              <MascotCanvas
                clip={clip}
                theme={theme}
                mobile={mobile}
                paused={hidden || offScreen}
                pointer={pointer}
                scroll={scroll}
                greet={greet}
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
