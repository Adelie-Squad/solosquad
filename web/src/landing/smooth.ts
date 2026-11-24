// The landing's scroll (DESIGN.md `## 랜딩`, 2026-11-24 — user: "레퍼런스처럼 스크롤할 때마다 내려가면서
// 자연스러워야 하는데 지금은 섹션마다 스크롤이 고정이었다가 내려가고 있어"). The page scrolls natively — no
// stops, no hold, nothing swallowed: every wheel turn moves the page by its own amount. Like the
// reference (Lenis), only the mouse wheel is smoothed: the wheel moves a target and the page follows
// it with an exponential ease (half the way in ~0.11 s), so a notch glides instead of jumping.
// Touch, keys and the scrollbar stay the browser's. Plain numbers and an injected clock/scroller,
// so the motion is testable.

/** The follow rate (1/s): the page closes 1 − e^(−RATE·dt) of the gap each frame — half in ln2/RATE ≈ 0.11 s. */
export const FOLLOW_RATE = 6.3;
/** Closer than this (px) is there. */
const DONE_PX = 0.5;

/** A wheel event's distance in px (lines · pages → px). */
export function wheelPixels(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, page: number): number {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * page;
  return e.deltaY;
}

export interface SmoothEnv {
  now: () => number;
  scrollY: () => number;
  /** the furthest the page scrolls */
  maxY: () => number;
  scrollTo: (y: number) => void;
  frame: (cb: () => void) => number;
  cancel: (id: number) => void;
}

/** One position after `dt` ms of following `target` from `y`. */
export const follow = (y: number, target: number, dt: number) => {
  const next = y + (target - y) * (1 - Math.exp((-FOLLOW_RATE * dt) / 1000));
  return Math.abs(target - next) < DONE_PX ? target : next;
};

export class SmoothScroll {
  private target: number | null = null;
  private y = 0;
  private last = 0;
  private raf = 0;

  constructor(private env: SmoothEnv) {}

  /** A wheel turn of `px`: the target moves by it (within the page) and the page glides after it. */
  wheel(px: number) {
    const from = this.target ?? this.env.scrollY();
    this.target = Math.max(0, Math.min(this.env.maxY(), from + px));
    this.start();
  }

  /** Glide to `y` (a link, a tab). */
  to(y: number) {
    this.target = Math.max(0, Math.min(this.env.maxY(), y));
    this.start();
  }

  /** The page moved by something else (keys, the scrollbar, a touch): forget the glide. */
  sync() {
    if (this.raf) return;
    this.target = null;
  }

  moving() {
    return !!this.raf;
  }

  stop() {
    if (this.raf > 0) this.env.cancel(this.raf);
    this.raf = 0;
    this.target = null;
  }

  private start() {
    if (this.raf) return;
    this.y = this.env.scrollY();
    this.last = this.env.now();
    this.raf = this.env.frame(this.tick);
  }

  private tick = () => {
    if (this.target === null) {
      this.raf = 0;
      return;
    }
    const t = this.env.now();
    this.y = follow(this.y, this.target, Math.min(64, t - this.last));
    this.last = t;
    // still ours while it moves the page: a scroll event this causes must not end the glide (sync)
    this.raf = -1;
    this.env.scrollTo(this.y);
    if (this.y === this.target) {
      this.raf = 0;
      this.target = null;
      return;
    }
    this.raf = this.env.frame(this.tick);
  };
}
