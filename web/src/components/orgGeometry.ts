// Connector lines of the org chart (DESIGN.md `### 조직도` — 연결선, 2026-11-10): 대표 → 임원 →
// a bus over each row of team columns → a drop to each team's dot. The lines between levels depend
// on where the columns wrapped, so they are one SVG drawn from measured boxes; the spine inside a
// team (dot → its members) is local to the team and stays CSS (`.orgchart-members` · `.landing-org-members`).
//
// Two layouts, chosen from the chart's own width (not the viewport — the same chart sits in a wide
// office and on a narrow scroll paper):
// - `columns`: team columns side by side, rows balanced (4 teams that do not fit in one row go 2 + 2,
//   not 3 + 1), one bus per row; a row after the first hangs from the bus above through the column
//   gap nearest the middle (grid columns line up across rows, so that gap is clear all the way down).
// - `tree`: one column, indented — a spine down from Chief's icon with a tick into each team's dot.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type OrgMode = 'columns' | 'tree';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node (or a team) and the small mark the line meets: a node's icon, a team's dot. */
export interface OrgBox {
  box: Box;
  pin: Box;
}

export interface OrgGeometry {
  mode: OrgMode;
  owners: OrgBox[];
  chief: OrgBox | null;
  /** The team columns (`li`), each with its dot as the pin, in reading order. */
  depts: OrgBox[];
  /** Where the lines leave the owner and Chief in columns: the node's middle (boxed nodes, the app)
   *  or its icon (borderless rows stacked with their icons in line, the landing). The tree always uses the icon. */
  topAt?: 'center' | 'pin';
}

export type OrgLineKind = 'trunk' | 'bus' | 'drop' | 'branch';

export interface OrgLine {
  kind: OrgLineKind;
  d: string;
}

/** The drop from a bus to a team, and the corner radius at a turn. */
export const DROP = 12;
export const RADIUS = 4;

/** Half-pixel aligned, so a 1px stroke covers whole pixels (the same pixels as a CSS 1px border at that x). */
const px = (v: number) => Math.round(v) + 0.5;
const cx = (b: Box) => b.x + b.w / 2;
const bottom = (b: Box) => b.y + b.h;

type Pt = readonly [number, number];

/** An orthogonal polyline with its turns rounded (radius clipped to half the shorter leg). */
export function roundedPath(points: Pt[], r = RADIUS): string {
  const p = points.map(([x, y]) => [px(x), px(y)] as const);
  if (p.length < 2) return '';
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = p[i - 1];
    const [bx, by] = p[i];
    const [nx, ny] = p[i + 1];
    const inLen = Math.hypot(bx - ax, by - ay);
    const outLen = Math.hypot(nx - bx, ny - by);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) {
      d += ` L${bx} ${by}`;
      continue;
    }
    const sx = bx - ((bx - ax) / inLen) * k;
    const sy = by - ((by - ay) / inLen) * k;
    const ex = bx + ((nx - bx) / outLen) * k;
    const ey = by + ((ny - by) / outLen) * k;
    d += ` L${sx} ${sy} Q${bx} ${by} ${ex} ${ey}`;
  }
  const [lx, ly] = p[p.length - 1];
  return `${d} L${lx} ${ly}`;
}

/** Teams whose dots sit on the same line form a row (in reading order). */
export function rowsOf(depts: OrgBox[]): OrgBox[][] {
  const rows: OrgBox[][] = [];
  for (const d of [...depts].sort((a, b) => a.pin.y - b.pin.y || a.box.x - b.box.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].pin.y - d.pin.y) < 4) row.push(d);
    else rows.push([d]);
  }
  return rows.map((r) => r.sort((a, b) => a.box.x - b.box.x));
}

interface Stub {
  x: number;
  /** Where the vertical ends away from the bus: a drop ends on a team's dot, the trunk starts above. */
  y: number;
  up: boolean;
}

/** One row's bus: the horizontal across all its stubs, its two end stubs turning into it. */
function busLines(stubs: Stub[], busY: number): OrgLine[] {
  const xs = stubs.map((s) => s.x);
  const L = Math.min(...xs);
  const R = Math.max(...xs);
  const kind = (s: Stub): OrgLineKind => (s.up ? 'trunk' : 'drop');
  const vertical = (s: Stub): OrgLine => ({ kind: kind(s), d: roundedPath([[s.x, s.y], [s.x, busY]]) });
  if (R - L < 1) {
    // one team straight under the line from above — the bus has no width
    const top = Math.min(...stubs.map((s) => (s.up ? s.y : busY)));
    const end = Math.max(...stubs.map((s) => (s.up ? busY : s.y)));
    return [{ kind: 'bus', d: roundedPath([[L, top], [L, end]]) }];
  }
  const at = (x: number) => stubs.filter((s) => Math.abs(s.x - x) < 1);
  const lefts = at(L);
  const rights = at(R);
  const pts: Pt[] = [];
  if (lefts.length === 1) pts.push([L, lefts[0].y]);
  pts.push([L, busY], [R, busY]);
  if (rights.length === 1) pts.push([R, rights[0].y]);
  const out: OrgLine[] = [{ kind: 'bus', d: roundedPath(pts) }];
  for (const s of stubs) {
    const end = Math.abs(s.x - L) < 1 ? lefts : Math.abs(s.x - R) < 1 ? rights : null;
    if (end && end.length === 1) continue; // drawn as the bus's own turn
    out.push(vertical(s));
  }
  return out;
}

/** 대표 → 임원: each owner down to a joint above Chief, then down into Chief. */
function topLines(owners: OrgBox[], chief: OrgBox, xOf: (n: OrgBox) => number): OrgLine[] {
  if (!owners.length) return [];
  const chiefX = xOf(chief);
  const from = Math.max(...owners.map((o) => bottom(o.box)));
  const mid = (from + chief.box.y) / 2;
  // one owner over Chief (centred, or both icons on the tree's spine) — one straight line
  if (owners.length === 1 && Math.abs(xOf(owners[0]) - chiefX) < 4) {
    return [{ kind: 'trunk', d: roundedPath([[chiefX, bottom(owners[0].box)], [chiefX, chief.box.y]]) }];
  }
  return owners.map((o) => ({
    kind: 'trunk' as const,
    d: roundedPath([[xOf(o), bottom(o.box)], [xOf(o), mid], [chiefX, mid], [chiefX, chief.box.y]]),
  }));
}

/** Every connector line for a measured chart. Pure — the hook below measures, this draws. */
export function orgLines(g: OrgGeometry): OrgLine[] {
  const { owners, chief, depts } = g;
  if (g.mode === 'tree') {
    const pinX = (n: OrgBox) => cx(n.pin);
    const lines: OrgLine[] = chief ? topLines(owners, chief, pinX) : [];
    if (!chief || !depts.length) return lines;
    const x = pinX(chief);
    const ys = depts.map((d) => d.pin.y + d.pin.h / 2);
    const last = Math.max(...ys);
    lines.push({ kind: 'trunk', d: roundedPath([[x, bottom(chief.box)], [x, last - RADIUS]]) });
    depts.forEach((d, i) => {
      const y = ys[i];
      const pts: Pt[] = y === last ? [[x, y - RADIUS], [x, y], [d.pin.x, y]] : [[x, y], [d.pin.x, y]];
      lines.push({ kind: 'branch', d: roundedPath(pts) });
    });
    return lines;
  }

  const topX = (n: OrgBox) => (g.topAt === 'pin' ? cx(n.pin) : cx(n.box));
  const lines: OrgLine[] = chief ? topLines(owners, chief, topX) : [];
  const rows = rowsOf(depts);
  if (!rows.length) return lines;
  // the column gap nearest the middle — a later row's line comes down through it
  const first = rows[0];
  const lastCol = first[first.length - 1].box;
  const middle = chief ? topX(chief) : (first[0].box.x + lastCol.x + lastCol.w) / 2;
  let gapX = middle;
  let best = Infinity;
  for (let i = 0; i + 1 < first.length; i++) {
    const g = (first[i].box.x + first[i].box.w + first[i + 1].box.x) / 2;
    if (Math.abs(g - middle) < best) {
      best = Math.abs(g - middle);
      gapX = g;
    }
  }
  let above = chief ? bottom(chief.box) : null;
  let prevBus: number | null = null;
  rows.forEach((row, i) => {
    const dotTop = Math.min(...row.map((d) => d.pin.y));
    const clear = i === 0 ? (above ?? dotTop - 2 * DROP) : Math.max(...rows[i - 1].map((d) => bottom(d.box)));
    const busY = dotTop - Math.max(2, Math.min(DROP, (dotTop - clear) / 2));
    const stubs: Stub[] = row.map((d) => ({ x: cx(d.pin), y: d.pin.y, up: false }));
    if (i === 0 && chief && above !== null) stubs.push({ x: topX(chief), y: above, up: true });
    if (i > 0 && prevBus !== null) stubs.push({ x: gapX, y: prevBus, up: true });
    lines.push(...busLines(stubs, busY));
    prevBus = busY;
    above = null;
  });
  return lines;
}

/** How many columns: as many as fit, then balanced over the rows it takes (max `max`). */
export function columnsFor(width: number, count: number, min: number, gap: number, max = Infinity): number {
  if (count <= 1) return 1;
  const fit = Math.max(1, Math.min(max, count, Math.floor((width + gap) / (min + gap))));
  const rows = Math.ceil(count / fit);
  return Math.ceil(count / rows);
}

export interface OrgLayoutOptions {
  /** How many team columns there are. */
  count: number;
  /** A column's smallest width and the gap between columns (px). */
  min: number;
  gap: number;
  /** Never more columns than this. */
  max?: number;
  /** Below this width the chart is the indented tree (px). */
  treeBelow: number;
  /** Anything that moves the nodes without resizing the chart (names, statuses). */
  key: string;
  topAt?: OrgGeometry['topAt'];
}

export interface OrgLayout {
  mode: OrgMode;
  cols: number;
  lines: OrgLine[];
  size: { w: number; h: number };
}

function measure(root: HTMLElement, mode: OrgMode, topAt: OrgGeometry['topAt']): { geometry: OrgGeometry; size: { w: number; h: number } } {
  const r = root.getBoundingClientRect();
  // the landing slides may be scaled while they move — draw in the chart's own (unscaled) pixels
  const s = root.offsetWidth > 0 && r.width > 0 ? r.width / root.offsetWidth : 1;
  const rel = (el: Element): Box => {
    const b = el.getBoundingClientRect();
    return { x: (b.left - r.left) / s, y: (b.top - r.top) / s, w: b.width / s, h: b.height / s };
  };
  const node = (el: Element): OrgBox => {
    const pin = el.querySelector('[data-org-pin]') ?? el.firstElementChild ?? el;
    return { box: rel(el), pin: rel(pin) };
  };
  const all = (sel: string) => [...root.querySelectorAll(sel)].map(node);
  return {
    geometry: { mode, topAt, owners: all('[data-org="owner"]'), chief: all('[data-org="chief"]')[0] ?? null, depts: all('[data-org="dept"]') },
    size: { w: root.offsetWidth, h: root.offsetHeight },
  };
}

/** The chart's layout from its width, and its lines from where the nodes ended up. */
export function useOrgLayout(ref: RefObject<HTMLElement | null>, o: OrgLayoutOptions): OrgLayout {
  const [width, setWidth] = useState(0);
  // width 0 = not measured yet (or no layout, as in tests): columns, as many as the cap allows
  const mode: OrgMode = width > 0 && width < o.treeBelow ? 'tree' : 'columns';
  const cols = mode === 'tree' ? 1 : width > 0 ? columnsFor(width, o.count, o.min, o.gap, o.max) : Math.max(1, Math.min(o.count, o.max ?? 4));
  const [drawn, setDrawn] = useState<{ lines: OrgLine[]; size: { w: number; h: number }; sig: string }>({ lines: [], size: { w: 0, h: 0 }, sig: '' });
  const { topAt } = o;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const redraw = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const { geometry, size } = measure(root, modeRef.current, topAt);
    const lines = orgLines(geometry);
    const sig = `${size.w}x${size.h}|${lines.map((l) => l.d).join('|')}`;
    setDrawn((prev) => (prev.sig === sig ? prev : { lines, size, sig }));
  }, [ref, topAt]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    setWidth(root.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setWidth(root.clientWidth);
      redraw();
    });
    ro.observe(root);
    for (const el of root.querySelectorAll('[data-org="dept"], [data-org="chief"], [data-org="owner"]')) ro.observe(el);
    return () => ro.disconnect();
  }, [ref, redraw, o.key, o.count]);

  // after every layout change of ours (mode, columns, names) the nodes have moved — measure again
  useLayoutEffect(redraw, [redraw, mode, cols, o.key]);

  useLayoutEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && redraw());
    return () => {
      live = false;
    };
  }, [redraw]);

  return { mode, cols, lines: drawn.lines, size: drawn.size };
}
