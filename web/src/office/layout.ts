// Where everything sits (DESIGN.md `## 사무실 장면` — 구성): one keycap island per team, its
// desks in a grid sized to its headcount, Chief alone on the centre island. No seat limit.

export interface SeatAgent {
  name: string;
  team: string | null;
}

export interface Desk {
  agent: string;
  team: string | null;
  /** Desk centre in world space (island top = y). */
  x: number;
  z: number;
}

export interface Island {
  key: string;
  team: string | null;
  x: number;
  z: number;
  w: number;
  d: number;
  desks: Desk[];
}

export const ISLAND_H = 0.6;
export const DESK_DX = 2.15;
export const DESK_DZ = 2.5;
/** Agent stands behind its desk (guide §8.5: desk z 0.25, agent z −0.8). */
export const AGENT_BACK = 1.05;
const MARGIN_X = 1.1;
const MARGIN_Z = 1.0;
const GAP = 1.1;
export const ENTRY = 'chief';

export function islandSize(n: number): { cols: number; rows: number; w: number; d: number } {
  // wide rather than deep — the iso view has more room across than up
  const cols = n <= 3 ? Math.max(1, n) : Math.min(4, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows, w: cols * DESK_DX + MARGIN_X, d: rows * DESK_DZ + MARGIN_Z };
}

/** Group agents by team (Chief apart), then place the islands on a grid with Chief in the middle. */
export function layoutOffice(agents: SeatAgent[], aspect = 1.6): Island[] {
  const chief = agents.find((a) => a.name === ENTRY);
  const byTeam = new Map<string, SeatAgent[]>();
  for (const a of agents) {
    if (a.name === ENTRY) continue;
    const key = a.team ?? '';
    byTeam.set(key, [...(byTeam.get(key) ?? []), a]);
  }
  const groups: { key: string; team: string | null; members: SeatAgent[] }[] = [...byTeam.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, members]) => ({ key: key || '·', team: key || null, members }));
  if (!chief && groups.length === 0) return [];
  type Sized = { key: string; team: string | null; members: SeatAgent[] } & ReturnType<typeof islandSize>;
  const size = (g: { key: string; team: string | null; members: SeatAgent[] }): Sized => ({ ...g, ...islandSize(g.members.length) });
  const centre = (sizes: number[]) => {
    const total = sizes.reduce((a, b) => a + b, 0) + GAP * (sizes.length - 1);
    let acc = -total / 2;
    return sizes.map((v) => {
      const mid = acc + v / 2;
      acc += v + GAP;
      return mid;
    });
  };
  const chiefIsland = chief ? size({ key: ENTRY, team: chief.team, members: [chief] }) : null;
  const sized = groups.map(size);
  /** Teams in `k` rows around Chief's island, which sits at the origin — the centre of the office. */
  const arrange = (k: number) => {
    const per = Math.ceil(sized.length / k) || 1;
    const rows: Sized[][] = Array.from({ length: k }, (_, r) => sized.slice(r * per, (r + 1) * per)).filter((r) => r.length);
    const placed: { g: Sized; x: number; z: number }[] = [];
    if (!chiefIsland) {
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
    const lineD = Math.max(chiefIsland.d, ...own.map((g) => g.d));
    placed.push({ g: chiefIsland, x: 0, z: 0 });
    let x = -chiefIsland.w / 2 - GAP;
    for (const g of [...left].reverse()) {
      placed.push({ g, x: x - g.w / 2, z: 0 });
      x -= g.w + GAP;
    }
    x = chiefIsland.w / 2 + GAP;
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
  // choose the row count whose iso footprint best matches the stage's shape, so the office fills
  // the frame instead of floating small in it: projected width ≈ (W + D)·cos30, height ≈ (W + D)·sin30 + 2
  let placed = arrange(1);
  let best = Infinity;
  for (let k = 1; k <= Math.max(1, sized.length); k++) {
    const cand = arrange(k);
    const xs = cand.flatMap((c) => [c.x - c.g.w / 2, c.x + c.g.w / 2]);
    const zs = cand.flatMap((c) => [c.z - c.g.d / 2, c.z + c.g.d / 2]);
    const W = Math.max(...xs) - Math.min(...xs);
    const D = Math.max(...zs) - Math.min(...zs);
    // the iso view sees x and z along two diagonals: width grows with both, depth adds height
    const pw = (W + D) * 0.866;
    const ph = (W + D) * 0.5 + 2.4;
    const miss = Math.abs(Math.log(pw / ph / aspect)) + 0.02 * Math.abs(W - D) / Math.max(W, D);
    if (miss < best) {
      best = miss;
      placed = cand;
    }
  }
  // Chief first, then the teams in name order
  placed.sort((a, b) => (a.g.key === ENTRY ? -1 : b.g.key === ENTRY ? 1 : a.g.key.localeCompare(b.g.key)));

  return placed.map(({ g, x, z }) => {
    const desks = g.members.map((m, k) => {
      const col = k % g.cols;
      const row = Math.floor(k / g.cols);
      return {
        agent: m.name,
        team: m.team,
        x: x + (col - (g.cols - 1) / 2) * DESK_DX,
        z: z + (row - (g.rows - 1) / 2) * DESK_DZ + AGENT_BACK / 2,
      };
    });
    return { key: g.key, team: g.team, x, z, w: g.w, d: g.d, desks };
  });
}

/** The scene's extent on the floor — for the camera and the shadow frustum. */
export function bounds(islands: Island[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (!islands.length) return { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
  return {
    minX: Math.min(...islands.map((i) => i.x - i.w / 2)),
    maxX: Math.max(...islands.map((i) => i.x + i.w / 2)),
    minZ: Math.min(...islands.map((i) => i.z - i.d / 2)),
    maxZ: Math.max(...islands.map((i) => i.z + i.d / 2)),
  };
}
