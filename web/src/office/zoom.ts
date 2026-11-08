// Zoom and pan for the office scene (DESIGN.md `## 사무실 장면` — 확대 · 축소). Pure: the five
// levels come from the layout (room, pods, one desk) and the stage's pixel size, and the
// controller below holds where the camera looks — the scene applies it, the page drives it
// (buttons, keys, wheel, drag, pinch, double-click). No three.js here, so it is tested as is.
//
// Coordinates: the camera looks along −VIEW (elevation 30°, azimuth 45°, contract §2). A world
// point p has view coordinates u = p·RIGHT, v = p·UP (screen right and screen up, metres); the
// camera sits on the VIEW line through the origin, so u, v are what its frustum is cut in.
import { WALL_H, type Footprint, type Pod, type Room } from './layout';

export const LEVELS = 5;
/** Tween between levels (DESIGN `## 모션` — eased, instant with reduced motion). */
export const ZOOM_MS = 360;

const A = Math.SQRT1_2;
const C30 = Math.cos(Math.PI / 6);
/** From the room towards the camera. */
export const VIEW_DIR: readonly [number, number, number] = [A * C30, 0.5, A * C30];
const RIGHT: readonly [number, number, number] = [A, 0, -A];
const UP: readonly [number, number, number] = [-A / 2, C30, -A / 2];

export function project(x: number, y: number, z: number): { u: number; v: number } {
  return { u: x * RIGHT[0] + z * RIGHT[2], v: x * UP[0] + y * UP[1] + z * UP[2] };
}

/** The floor point (y = 0) seen at view coordinates (u, v). */
export function floorPoint(u: number, v: number): { x: number; z: number } {
  // p = u·RIGHT + v·UP + t·VIEW with p.y = 0  →  t = −v·cos30 / sin30
  const t = (-v * UP[1]) / VIEW_DIR[1];
  return { x: u * RIGHT[0] + v * UP[0] + t * VIEW_DIR[0], z: u * RIGHT[2] + v * UP[2] + t * VIEW_DIR[2] };
}

export interface ViewRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** A world box seen from the camera: the view rectangle around its eight corners. */
export function viewRect(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ViewRect {
  const r: ViewRect = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const p = project(x, y, z);
        r.u0 = Math.min(r.u0, p.u);
        r.u1 = Math.max(r.u1, p.u);
        r.v0 = Math.min(r.v0, p.v);
        r.v1 = Math.max(r.v1, p.v);
      }
    }
  }
  return r;
}

/** How high above the floor a seat's framing reaches: the seated penguin and its name tag. */
const SEAT_TOP = 1.8;
/** L5 framing: the desk, the penguin and its tag anchor (head + 0.3 m). */
const DESK_TOP = 1.6;
/** The desk module's footprint (desk + chair) when the GLB does not say. */
const DESK: Footprint = { w: 0.96, d: 1.0 };

export interface OfficeFrame {
  width: number;
  height: number;
  /** The frustum at zoom 1 — the whole room (floor + walls) fitted to the stage. */
  fit: { u: number; v: number; w: number; h: number };
  /** The room seen from the camera; the pan keeps the view inside it (plus a margin). */
  bounds: ViewRect;
  /** Five increasing zooms (×fit): whole office · half · large team · small team · one agent. */
  levels: number[];
  /** Where to look for each agent's desk. */
  agents: Record<string, { u: number; v: number }>;
  /** Each team pod: its centre and the level that frames it (3 or 4). */
  teams: Record<string, { u: number; v: number; level: number }>;
}

/** The zoom (×fit) that frames a view rectangle with `pad` metres around it. */
function zoomFor(fit: OfficeFrame['fit'], r: ViewRect, pad: number): number {
  return Math.min(fit.w / (r.u1 - r.u0 + pad * 2), fit.h / (r.v1 - r.v0 + pad * 2));
}

const podRect = (p: Pod) => viewRect(p.x - p.w / 2, p.x + p.w / 2, 0, SEAT_TOP, p.z - p.d / 2, p.z + p.d / 2);
const centre = (r: ViewRect) => ({ u: (r.u0 + r.u1) / 2, v: (r.v0 + r.v1) / 2 });
/** Neighbouring levels at least this far apart. */
const STEP = 1.2;

/**
 * The five levels, derived from the layout so any team size or room works:
 * L1 = the whole room · L2 = halfway (geometric) between L1 and L3 — about half the office ·
 * L3 = the largest team pod · L4 = the smallest team pod · L5 = one desk with its penguin.
 * (Zooming in goes whole → large team → small team; with every pod the same size L4 sits
 * halfway to L5.) Each step is at least ×1.2 so the five are always distinct.
 */
export function officeFrame(pods: Pod[], room: Room, width: number, height: number, desk: Footprint = DESK): OfficeFrame {
  const bounds = viewRect(room.minX, room.maxX, 0, WALL_H, room.minZ, room.maxZ);
  const pad = 0.12;
  let w = bounds.u1 - bounds.u0 + pad * 2;
  let h = bounds.v1 - bounds.v0 + pad * 2;
  const aspect = Math.max(1, width) / Math.max(1, height);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const fit = { ...centre(bounds), w, h };

  const teamPods = pods.filter((p) => !p.desks.some((d) => d.chief));
  const sized = (teamPods.length ? teamPods : pods).map((p) => ({ p, zoom: zoomFor(fit, podRect(p), 0.3) }));
  const large = sized.length ? Math.min(...sized.map((s) => s.zoom)) : 2;
  const small = sized.length ? Math.max(...sized.map((s) => s.zoom)) : 3;
  // one desk set up to the top of its name tag, tight — the neighbours only peek in at the edges
  const one = zoomFor(fit, viewRect(-desk.w / 2, desk.w / 2, 0, DESK_TOP, -desk.d / 2, desk.d / 2), 0.1);

  const l1 = 1;
  const l3 = Math.max(large, l1 * STEP * STEP);
  const l5 = Math.max(one, l3 * STEP * STEP);
  const between = (lo: number, hi: number, want: number) => (want >= lo * STEP && want <= hi / STEP ? want : Math.sqrt(lo * hi));
  const l2 = between(l1, l3, Math.sqrt(l1 * l3));
  const l4 = between(l3, l5, small);
  const levels = [l1, l2, l3, l4, l5];

  const agents: OfficeFrame['agents'] = {};
  const teams: OfficeFrame['teams'] = {};
  for (const p of pods) {
    for (const d of p.desks) agents[d.agent] = centre(viewRect(d.x - desk.w / 2, d.x + desk.w / 2, 0, DESK_TOP, d.z - desk.d / 2, d.z + desk.d / 2));
    if (p.desks.some((d) => d.chief)) continue;
    const z = zoomFor(fit, podRect(p), 0.3);
    // the closest of L3 / L4 that still shows the whole pod
    const level = z >= levels[3] / 1.02 ? 4 : 3;
    teams[p.key] = { ...centre(podRect(p)), level };
  }
  return { width, height, fit, bounds, levels, agents, teams };
}

/** The level a zoom is closest to (1–5, by ratio). */
export function nearestLevel(levels: number[], zoom: number): number {
  let best = 0;
  for (let i = 1; i < levels.length; i++) if (Math.abs(Math.log(zoom / levels[i])) < Math.abs(Math.log(zoom / levels[best]))) best = i;
  return best + 1;
}

/** From L3 every agent's name tag shows — the penguins are far enough apart. */
export const TAGS_ALL_FROM = 3;
export const tagsShowAll = (level: number) => level >= TAGS_ALL_FROM;

// ------------------------------------------------------------------ name tags

export type TagStatus = 'idle' | 'thinking' | 'typing' | 'waiting' | 'done' | 'error';

/** Who keeps their tag when two collide: pointed at, then waiting · error · working · done · idle. */
export function tagPriority(status: TagStatus, pointed: boolean): number {
  if (pointed) return 0;
  return { waiting: 1, error: 2, typing: 3, thinking: 3, done: 4, idle: 5 }[status];
}

export interface TagBox {
  name: string;
  /** The tag's anchor (bottom centre) on screen, and its size, px. */
  x: number;
  y: number;
  w: number;
  h: number;
  prio: number;
}

/** Tags that would overlap a higher-priority one — hidden rather than drawn smaller. */
export function collidingTags(tags: TagBox[], gap = 2): Set<string> {
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const hidden = new Set<string>();
  for (const tag of [...tags].sort((a, b) => a.prio - b.prio || a.y - b.y)) {
    const box = { l: tag.x - tag.w / 2 - gap, r: tag.x + tag.w / 2 + gap, t: tag.y - tag.h - gap, b: tag.y + gap };
    if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) hidden.add(tag.name);
    else placed.push(box);
  }
  return hidden;
}

// ------------------------------------------------------------------ input rules

export type WheelMode = 'modifier' | 'always';

/**
 * Does this wheel event zoom? On the office page a plain wheel scrolls the page — only a pinch
 * (the browser sends it as ctrl+wheel) or ⌘/ctrl+wheel zooms. On the pop-out display there is
 * no page to scroll, so every wheel zooms.
 */
export function wheelZooms(e: { ctrlKey: boolean; metaKey: boolean }, mode: WheelMode): boolean {
  return mode === 'always' || e.ctrlKey || e.metaKey;
}

/** The zoom factor for one wheel event (a pinch sends small deltas, a mouse wheel large ones). */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  const k = e.ctrlKey ? 0.01 : 0.0025;
  return Math.exp(-Math.max(-300, Math.min(300, dy)) * k);
}

// ------------------------------------------------------------------ the controller

export interface ZoomView {
  zoom: number;
  u: number;
  v: number;
}

export interface SavedZoom {
  level: number;
  u: number;
  v: number;
}

export function loadZoom(key: string | undefined): SavedZoom | null {
  if (!key) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<SavedZoom> | null;
    if (!raw || typeof raw.level !== 'number' || typeof raw.u !== 'number' || typeof raw.v !== 'number') return null;
    if (![raw.u, raw.v].every(Number.isFinite)) return null;
    return { level: Math.min(LEVELS, Math.max(1, Math.round(raw.level))), u: raw.u, v: raw.v };
  } catch {
    return null;
  }
}

export function saveZoom(key: string | undefined, z: SavedZoom): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ level: z.level, u: Number(z.u.toFixed(3)), v: Number(z.v.toFixed(3)) }));
  } catch {
    // not remembered; the view still works
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const SETTLE_MS = 160;

/** `change` every move · `level` the nearest level changed · `settle` a move by the person ended ·
 * `frame` new levels (layout or stage size) — the view is settled there too. */
export type ZoomEvent = 'change' | 'level' | 'settle' | 'frame';

/**
 * Where the office camera looks. The page calls the verbs (buttons, keys, wheel, drag, pinch,
 * focus on an agent or a team); the scene calls `setFrame` when the layout or the stage size
 * changes and `tick` every frame, and applies `view`. Level and centre are saved on settle.
 */
export class ZoomController {
  frame: OfficeFrame | null = null;
  view: ZoomView = { zoom: 1, u: 0, v: 0 };
  reduced = false;
  private anim: { from: ZoomView; to: ZoomView; t0: number } | null = null;
  private listeners = new Set<(e: ZoomEvent) => void>();
  private shownLevel = 1;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private saved: SavedZoom | null;

  constructor(
    readonly storageKey?: string,
    private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ) {
    this.saved = loadZoom(storageKey);
  }

  subscribe(fn: (e: ZoomEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ZoomEvent) {
    for (const fn of this.listeners) fn(e);
  }

  /** The level the view is at (or closest to), 1–5. */
  level(): number {
    return this.shownLevel;
  }

  /** Where the view is headed (the end of a running tween). */
  target(): ZoomView {
    return this.anim?.to ?? this.view;
  }

  setFrame(frame: OfficeFrame): void {
    const first = !this.frame;
    const level = first ? (this.saved?.level ?? 1) : nearestLevel(this.frame!.levels, this.target().zoom);
    const at = first ? this.saved : this.target();
    this.frame = frame;
    this.anim = null;
    this.view = this.clamp({ zoom: frame.levels[level - 1], u: at?.u ?? frame.fit.u, v: at?.v ?? frame.fit.v });
    this.shownLevel = level;
    this.emit('change');
    this.emit('level');
    this.emit('frame'); // settled too, but by the layout — not a change to announce
  }

  /** Keep the view inside the room (plus a small margin), the zoom inside L1–L5. */
  clamp(v: ZoomView): ZoomView {
    const f = this.frame;
    if (!f) return v;
    const zoom = Math.min(f.levels[LEVELS - 1], Math.max(f.levels[0], v.zoom));
    if (zoom <= f.levels[0] * 1.001) return { zoom, u: f.fit.u, v: f.fit.v }; // the whole room: nothing to pan
    const w = f.fit.w / zoom;
    const h = f.fit.h / zoom;
    const m = f.fit.w * 0.04;
    const axis = (c: number, lo: number, hi: number, span: number, mid: number) => {
      const a = lo - m + span / 2;
      const b = hi + m - span / 2;
      return a > b ? mid : Math.min(b, Math.max(a, c));
    };
    return {
      zoom,
      u: axis(v.u, f.bounds.u0, f.bounds.u1, w, f.fit.u),
      v: axis(v.v, f.bounds.v0, f.bounds.v1, h, f.fit.v),
    };
  }

  /** Move to a view — eased over ZOOM_MS, or at once (reduced motion, `animate` false). */
  goTo(to: ZoomView, animate = true): void {
    if (!this.frame) return;
    const end = this.clamp(to);
    if (!animate || this.reduced) {
      this.anim = null;
      this.view = end;
      this.changed();
      this.settleSoon(0);
      return;
    }
    this.anim = { from: { ...this.view }, to: end, t0: this.now() };
    this.emit('change');
  }

  /** Advance a running tween; true when the view moved. */
  tick(now = this.now()): boolean {
    const a = this.anim;
    if (!a) return false;
    const t = Math.min(1, (now - a.t0) / ZOOM_MS);
    const k = ease(t);
    this.view = {
      zoom: Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * k),
      u: a.from.u + (a.to.u - a.from.u) * k,
      v: a.from.v + (a.to.v - a.from.v) * k,
    };
    if (t >= 1) {
      this.anim = null;
      this.view = a.to;
      this.changed();
      this.settleSoon(0);
    } else this.changed();
    return true;
  }

  private changed() {
    this.emit('change');
    if (!this.frame) return;
    const lv = nearestLevel(this.frame.levels, this.view.zoom);
    if (lv !== this.shownLevel) {
      this.shownLevel = lv;
      this.emit('level');
    }
  }

  private settleSoon(ms = SETTLE_MS) {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    const done = () => {
      this.settleTimer = null;
      saveZoom(this.storageKey, { level: this.shownLevel, u: this.view.u, v: this.view.v });
      this.emit('settle');
    };
    if (ms <= 0) done();
    else this.settleTimer = setTimeout(done, ms);
  }

  setLevel(n: number, at?: { u: number; v: number }): void {
    const f = this.frame;
    if (!f) return;
    const level = Math.min(LEVELS, Math.max(1, Math.round(n)));
    const cur = this.target();
    this.goTo({ zoom: f.levels[level - 1], u: at?.u ?? cur.u, v: at?.v ?? cur.v });
  }

  /** One level in (from where the view is, so a pinch between levels goes to the next one up). */
  stepIn(): void {
    const f = this.frame;
    if (!f) return;
    const z = this.target().zoom;
    const i = f.levels.findIndex((l) => l > z * 1.02);
    if (i >= 0) this.setLevel(i + 1);
  }

  stepOut(): void {
    const f = this.frame;
    if (!f) return;
    const z = this.target().zoom;
    let i = -1;
    f.levels.forEach((l, k) => {
      if (l < z / 1.02) i = k;
    });
    if (i >= 0) this.setLevel(i + 1);
  }

  /** 전체 보기 — back to L1, centred. */
  fit(): void {
    if (this.frame) this.goTo({ zoom: this.frame.levels[0], u: this.frame.fit.u, v: this.frame.fit.v });
  }

  focusAgent(name: string): boolean {
    const at = this.frame?.agents[name];
    if (!at) return false;
    this.setLevel(LEVELS, at);
    return true;
  }

  focusTeam(key: string): boolean {
    const team = this.frame?.teams[key];
    if (!team) return false;
    this.setLevel(team.level, team);
    return true;
  }

  /** Zoom by `factor` keeping the point under (px, py) — stage pixels — where it is. */
  zoomAt(factor: number, px: number, py: number): void {
    const f = this.frame;
    if (!f) return;
    this.anim = null;
    const cur = this.view;
    const zoom = Math.min(f.levels[LEVELS - 1], Math.max(f.levels[0], cur.zoom * factor));
    // the view point under the pointer, before and after
    const sx = px / Math.max(1, f.width) - 0.5;
    const sy = 0.5 - py / Math.max(1, f.height);
    const pu = cur.u + (sx * f.fit.w) / cur.zoom;
    const pv = cur.v + (sy * f.fit.h) / cur.zoom;
    this.view = this.clamp({ zoom, u: pu - (sx * f.fit.w) / zoom, v: pv - (sy * f.fit.h) / zoom });
    this.changed();
    this.settleSoon();
  }

  /** Drag the room by (dx, dy) stage pixels. */
  panBy(dx: number, dy: number): void {
    const f = this.frame;
    if (!f) return;
    this.anim = null;
    const cur = this.view;
    this.view = this.clamp({ zoom: cur.zoom, u: cur.u - (dx / Math.max(1, f.width)) * (f.fit.w / cur.zoom), v: cur.v + (dy / Math.max(1, f.height)) * (f.fit.h / cur.zoom) });
    this.changed();
    this.settleSoon();
  }

  /** More than the whole room — something to pan. */
  zoomed(): boolean {
    return !!this.frame && this.target().zoom > this.frame.levels[0] * 1.001;
  }

  dispose(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.listeners.clear();
  }
}
