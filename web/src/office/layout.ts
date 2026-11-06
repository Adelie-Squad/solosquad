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
export function layoutOffice(agents: SeatAgent[]): Island[] {
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
  // teams split over a row behind and a row in front; Chief's island alone in the middle row,
  // so Chief sits at the centre of the office whatever the number of teams
  const half = Math.ceil(groups.length / 2);
  const rows: Sized[][] = [groups.slice(0, half).map(size), ...(chief ? [[size({ key: ENTRY, team: chief.team, members: [chief] })]] : []), groups.slice(half).map(size)].filter((r) => r.length);
  const centre = (sizes: number[]) => {
    const total = sizes.reduce((a, b) => a + b, 0) + GAP * (sizes.length - 1);
    let acc = -total / 2;
    return sizes.map((v) => {
      const mid = acc + v / 2;
      acc += v + GAP;
      return mid;
    });
  };
  const rowZ = centre(rows.map((r) => Math.max(...r.map((g) => g.d))));
  const placed: { g: Sized; x: number; z: number }[] = [];
  rows.forEach((row, ri) => {
    const xs = centre(row.map((g) => g.w));
    row.forEach((g, i) => placed.push({ g, x: xs[i], z: rowZ[ri] }));
  });
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
