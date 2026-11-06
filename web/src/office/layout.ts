// Where everything sits (DESIGN.md `## 사무실 장면` — 구성): one desk pod per team, its desks in
// a grid sized to its headcount, Chief alone at the centre desk, and a room of 2 m floor tiles
// (asset contract §2) that grows to hold them. No seat limit. Pure — the scene measures the GLB
// modules and passes their footprints in, so the real kit and the placeholder both fit.

export interface SeatAgent {
  name: string;
  team: string | null;
  /** The name people read on the tag (display name); the id when absent. */
  label?: string;
}

export interface Desk {
  agent: string;
  team: string | null;
  /** Desk module origin (floor, centre of the desk + chair footprint); the sitter faces +Z. */
  x: number;
  z: number;
  chief: boolean;
}

export interface Pod {
  key: string;
  team: string | null;
  /** Pod centre and footprint on the floor. */
  x: number;
  z: number;
  w: number;
  d: number;
  desks: Desk[];
}

export interface Footprint {
  w: number;
  d: number;
}

export interface LayoutOptions {
  /** Stage width / height — the pods are arranged so the room fills the frame. */
  aspect?: number;
  /** `desk.set` and `desk.chief` footprints (measured from the GLB). */
  desk?: Footprint;
  chiefDesk?: Footprint;
}

export const TILE = 2;
export const WALL_H = 2.4;
export const ENTRY = 'chief';
const DESK: Footprint = { w: 0.96, d: 1.0 };
const CHIEF_DESK: Footprint = { w: 1.3, d: 1.0 };
/** Space between desks in a pod (aisle behind the chairs), and between pods. */
const DESK_GAP_X = 0.25;
const DESK_GAP_Z = 0.55;
const POD_PAD = 0.35;
const GAP = 1.1;

export function podSize(n: number, desk: Footprint = DESK): { cols: number; rows: number; w: number; d: number } {
  // wide rather than deep — the iso view has more room across than up
  const cols = n <= 3 ? Math.max(1, n) : Math.min(4, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const pitchX = desk.w + DESK_GAP_X;
  const pitchZ = desk.d + DESK_GAP_Z;
  return { cols, rows, w: cols * pitchX - DESK_GAP_X + POD_PAD * 2, d: rows * pitchZ - DESK_GAP_Z + POD_PAD * 2 };
}

type Group = { key: string; team: string | null; members: SeatAgent[] };
type Sized = Group & ReturnType<typeof podSize> & { chief: boolean };

/** Group agents by team (Chief apart), then place the pods on a grid with Chief in the middle. */
export function layoutOffice(agents: SeatAgent[], opts: LayoutOptions = {}): Pod[] {
  const aspect = opts.aspect ?? 1.6;
  const desk = opts.desk ?? DESK;
  const chiefDesk = opts.chiefDesk ?? CHIEF_DESK;
  const chief = agents.find((a) => a.name === ENTRY);
  const byTeam = new Map<string, SeatAgent[]>();
  for (const a of agents) {
    if (a.name === ENTRY) continue;
    const key = a.team ?? '';
    byTeam.set(key, [...(byTeam.get(key) ?? []), a]);
  }
  const groups: Group[] = [...byTeam.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, members]) => ({ key: key || '·', team: key || null, members }));
  if (!chief && groups.length === 0) return [];
  const size = (g: Group, isChief = false): Sized => ({ ...g, ...podSize(g.members.length, isChief ? chiefDesk : desk), chief: isChief });
  const centre = (sizes: number[]) => {
    const total = sizes.reduce((a, b) => a + b, 0) + GAP * (sizes.length - 1);
    let acc = -total / 2;
    return sizes.map((v) => {
      const mid = acc + v / 2;
      acc += v + GAP;
      return mid;
    });
  };
  const chiefPod = chief ? size({ key: ENTRY, team: chief.team, members: [chief] }, true) : null;
  const sized = groups.map((g) => size(g));
  /** Teams in `k` rows around Chief's pod, which sits at the origin — the centre of the room. */
  const arrange = (k: number) => {
    const per = Math.ceil(sized.length / k) || 1;
    const rows: Sized[][] = Array.from({ length: k }, (_, r) => sized.slice(r * per, (r + 1) * per)).filter((r) => r.length);
    const placed: { g: Sized; x: number; z: number }[] = [];
    if (!chiefPod) {
      const rowZ = centre(rows.map((r) => Math.max(...r.map((g) => g.d))));
      rows.forEach((row, ri) => {
        const xs = centre(row.map((g) => g.w));
        row.forEach((g, i) => placed.push({ g, x: xs[i], z: rowZ[ri] }));
      });
      return placed;
    }
    // Chief's row: the middle team row splits left and right of Chief
    const midRow = rows.length ? Math.floor((rows.length - 1) / 2) : -1;
    const own = midRow >= 0 && rows.length % 2 === 1 ? rows[midRow] : [];
    const left = own.slice(0, Math.floor(own.length / 2));
    const right = own.slice(Math.floor(own.length / 2));
    const lineD = Math.max(chiefPod.d, ...own.map((g) => g.d));
    placed.push({ g: chiefPod, x: 0, z: 0 });
    let x = -chiefPod.w / 2 - GAP;
    for (const g of [...left].reverse()) {
      placed.push({ g, x: x - g.w / 2, z: 0 });
      x -= g.w + GAP;
    }
    x = chiefPod.w / 2 + GAP;
    for (const g of right) {
      placed.push({ g, x: x + g.w / 2, z: 0 });
      x += g.w + GAP;
    }
    const others = rows.filter((r) => r !== own);
    const behind = others.slice(0, Math.floor(others.length / 2));
    const front = others.slice(Math.floor(others.length / 2));
    let z = -lineD / 2 - GAP;
    for (const row of [...behind].reverse()) {
      const d = Math.max(...row.map((g) => g.d));
      const xs = centre(row.map((g) => g.w));
      row.forEach((g, i) => placed.push({ g, x: xs[i], z: z - d / 2 }));
      z -= d + GAP;
    }
    z = lineD / 2 + GAP;
    for (const row of front) {
      const d = Math.max(...row.map((g) => g.d));
      const xs = centre(row.map((g) => g.w));
      row.forEach((g, i) => placed.push({ g, x: xs[i], z: z + d / 2 }));
      z += d + GAP;
    }
    return placed;
  };
  // choose the row count whose iso footprint best matches the stage's shape, so the room fills
  // the frame instead of floating small in it: projected width ≈ (W + D)·cos30, height ≈ (W + D)·sin30 + wall
  let placed = arrange(1);
  let best = Infinity;
  for (let k = 1; k <= Math.max(1, sized.length); k++) {
    const cand = arrange(k);
    const xs = cand.flatMap((c) => [c.x - c.g.w / 2, c.x + c.g.w / 2]);
    const zs = cand.flatMap((c) => [c.z - c.g.d / 2, c.z + c.g.d / 2]);
    const W = Math.max(...xs) - Math.min(...xs) + PROP_STRIP;
    const D = Math.max(...zs) - Math.min(...zs) + PROP_STRIP;
    const pw = (W + D) * 0.707;
    const ph = (W + D) * 0.354 + WALL_H * 0.866;
    const miss = Math.abs(Math.log(pw / ph / aspect)) + (0.02 * Math.abs(W - D)) / Math.max(W, D);
    if (miss < best) {
      best = miss;
      placed = cand;
    }
  }
  // Chief first, then the teams in name order
  placed.sort((a, b) => (a.g.chief ? -1 : b.g.chief ? 1 : a.g.key.localeCompare(b.g.key)));

  return placed.map(({ g, x, z }) => {
    const fp = g.chief ? chiefDesk : desk;
    const pitchX = fp.w + DESK_GAP_X;
    const pitchZ = fp.d + DESK_GAP_Z;
    const desks = g.members.map((m, k) => {
      const col = k % g.cols;
      const row = Math.floor(k / g.cols);
      return {
        agent: m.name,
        team: m.team,
        x: x + (col - (g.cols - 1) / 2) * pitchX,
        z: z + (row - (g.rows - 1) / 2) * pitchZ,
        chief: g.chief,
      };
    });
    return { key: g.key, team: g.team, x, z, w: g.w, d: g.d, desks };
  });
}

// ------------------------------------------------------------------ the room

/** Strip along the back and left walls kept free for the shared props. */
export const PROP_STRIP = 1.6;
/** Walkway on the open sides (front, right). */
const OPEN_EDGE = 0.8;

export interface Room {
  /** Inner corner where the two walls meet (the floor starts here and runs to +X, +Z). */
  minX: number;
  minZ: number;
  /** Floor tiles across (x) and deep (z). */
  cols: number;
  rows: number;
  maxX: number;
  maxZ: number;
}

export type PropModule = 'prop.plant' | 'prop.shelf' | 'prop.whiteboard' | 'prop.sofa' | 'prop.coffee_bar';

export interface PropSpot {
  module: PropModule;
  /** Against which wall: its back touches the wall, its front (+Z of the module) faces the room. */
  wall: 'back' | 'left';
  /** 0..1 along that wall (back: from left to right, left: from back to front). */
  along: number;
}

/** The shared props — the same set in every room, however many agents (DESIGN.md 구성). */
export const PROP_SPOTS: PropSpot[] = [
  { module: 'prop.plant', wall: 'back', along: 0 },
  { module: 'prop.whiteboard', wall: 'back', along: 0.45 },
  { module: 'prop.shelf', wall: 'back', along: 0.85 },
  { module: 'prop.coffee_bar', wall: 'left', along: 0.3 },
  { module: 'prop.sofa', wall: 'left', along: 0.75 },
];

/** The smallest tiled room around the pods, with the prop strip along the two walls. */
export function roomFor(pods: Pod[]): Room {
  const b = podBounds(pods);
  const minX0 = b.minX - PROP_STRIP;
  const minZ0 = b.minZ - PROP_STRIP;
  const cols = Math.max(2, Math.ceil((b.maxX + OPEN_EDGE - minX0) / TILE - 1e-6));
  const rows = Math.max(2, Math.ceil((b.maxZ + OPEN_EDGE - minZ0) / TILE - 1e-6));
  // centre the slack so the pods do not hug one side
  const minX = minX0 - (cols * TILE - (b.maxX + OPEN_EDGE - minX0)) / 2;
  const minZ = minZ0 - (rows * TILE - (b.maxZ + OPEN_EDGE - minZ0)) / 2;
  return { minX, minZ, cols, rows, maxX: minX + cols * TILE, maxZ: minZ + rows * TILE };
}

/** The pods' extent on the floor. */
export function podBounds(pods: Pod[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (!pods.length) return { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  return {
    minX: Math.min(...pods.map((i) => i.x - i.w / 2)),
    maxX: Math.max(...pods.map((i) => i.x + i.w / 2)),
    minZ: Math.min(...pods.map((i) => i.z - i.d / 2)),
    maxZ: Math.max(...pods.map((i) => i.z + i.d / 2)),
  };
}

/**
 * Tile centres of the floor, and where the wall pieces go. A wall module's origin is the centre of
 * the floor tile it borders (contract §3): it sits at that tile's position and stands outside the
 * tile's −X (left) or back (−Z) edge — the first column of tiles carries the left wall, the first
 * row the back wall, the corner tile the corner post.
 */
export function roomTiles(room: Room): {
  floor: { x: number; z: number }[];
  wallLeft: { x: number; z: number }[];
  wallBack: { x: number; z: number }[];
  corner: { x: number; z: number };
} {
  const cx = (i: number) => room.minX + TILE * (i + 0.5);
  const cz = (j: number) => room.minZ + TILE * (j + 0.5);
  const floor: { x: number; z: number }[] = [];
  for (let i = 0; i < room.cols; i++) for (let j = 0; j < room.rows; j++) floor.push({ x: cx(i), z: cz(j) });
  return {
    floor,
    wallLeft: Array.from({ length: room.rows }, (_, j) => ({ x: cx(0), z: cz(j) })),
    wallBack: Array.from({ length: room.cols }, (_, i) => ({ x: cx(i), z: cz(0) })),
    corner: { x: cx(0), z: cz(0) },
  };
}

/** Where a shared prop stands: on the floor, `depth / 2` off its wall, rotated to face the room. */
export function propPlace(spot: PropSpot, room: Room, fp: Footprint): { x: number; z: number; rotY: number } {
  const inset = 0.08;
  if (spot.wall === 'back') {
    const span = room.maxX - room.minX - fp.w - inset * 2;
    return { x: room.minX + inset + fp.w / 2 + span * spot.along, z: room.minZ + inset + fp.d / 2, rotY: 0 };
  }
  // against the left wall the module turns a quarter so its front (+Z) faces +X
  const span = room.maxZ - room.minZ - fp.w - inset * 2 - PROP_STRIP;
  return { x: room.minX + inset + fp.d / 2, z: room.minZ + PROP_STRIP + inset + fp.w / 2 + span * spot.along, rotY: Math.PI / 2 };
}
