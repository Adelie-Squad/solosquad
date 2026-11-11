// Why the scene could sit on 불러오는 중 forever: R3F mounts nothing inside <Canvas> until
// react-use-measure reports a non-zero size, and it learns the size only from a ResizeObserver.
// A ResizeObserver delivers in a rendering frame — and a page that is not being rendered (a
// background tab, a window behind others, a page opened for a screenshot) has none, so the
// first measurement never came and the stage stayed on its loading text. These are pure so a
// test can hold them without WebGL.

type Observer = typeof ResizeObserver;

/** A ResizeObserver that also reports once right after `observe`, from a timer — timers run in
 * a page that is not rendering, frames do not. react-use-measure reads the element's rect
 * itself, so the empty entry list is enough. Later sizes still come from the real observer. */
export function measureNowObserver(Base: Observer | undefined = typeof window === 'undefined' ? undefined : window.ResizeObserver): Observer | undefined {
  if (!Base) return undefined;
  return class MeasureNow extends Base {
    readonly #report: ResizeObserverCallback;
    #timers = new Set<ReturnType<typeof setTimeout>>();
    constructor(report: ResizeObserverCallback) {
      super(report);
      this.#report = report;
    }
    observe(target: Element, options?: ResizeObserverOptions) {
      super.observe(target, options);
      const id = setTimeout(() => {
        this.#timers.delete(id);
        this.#report([], this);
      }, 0);
      this.#timers.add(id);
    }
    disconnect() {
      for (const id of this.#timers) clearTimeout(id);
      this.#timers.clear();
      super.disconnect();
    }
  };
}

export type FrameLoop = 'always' | 'demand' | 'never';

/** How the scene draws. Shown in the pop-out or scrolled away → not at all. A hidden page →
 * on demand: it costs nothing (the browser runs no frames there) yet the one frame a browser
 * does make for a hidden page — a screenshot, a thumbnail — shows the office, not an empty
 * canvas. Reduced motion → on demand too; otherwise every frame. */
export function frameLoop({ paused, offScreen, hidden, reducedMotion }: { paused: boolean; offScreen: boolean; hidden: boolean; reducedMotion: boolean }): FrameLoop {
  if (paused || offScreen) return 'never';
  if (hidden || reducedMotion) return 'demand';
  return 'always';
}
