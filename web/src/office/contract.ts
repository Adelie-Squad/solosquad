// The office asset contract (docs/design/office-asset-contract.md) as data, and the check that
// a GLB honours it. The Blender session's GLBs must drop in without code changes, so every name
// the web looks up lives here — the scene, the placeholder generator, the CLI check and the
// tests all read the same lists.
//
// No imports and only erasable TypeScript: `scripts/*.mjs` load this file with Node's own type
// stripping (no build step), and the scene reads it at runtime against `gltf.parser.json`.

/** office-kit.glb — root nodes the web clones to build the room (§3). */
export const MODULES = [
  'room.floor_tile',
  'room.wall_left',
  'room.wall_back',
  'room.corner',
  'desk.set',
  'desk.chief',
  'lamp.desk',
  'prop.plant',
  'prop.shelf',
  'prop.whiteboard',
  'prop.sofa',
  'prop.coffee_bar',
] as const;
export type ModuleName = (typeof MODULES)[number];

/** Empty node inside `lamp.desk` where the bulb's light (and its warm pool) sits. */
export const LAMP_LIGHT = 'lamp.desk.light';

/** Optional empties that override the fixed seat / lamp offsets below (`desk.set.seat` …). */
export const ANCHORS = {
  seat: '.seat',
  lamp: '.lamp',
} as const;

export const DESKS = ['desk.set', 'desk.chief'] as const;
export type DeskModule = (typeof DESKS)[number];

/** Desk widths (§3) — the lamp stands `w / 2 - 0.12` in from the left edge. */
export const DESK_WIDTH: Record<DeskModule, number> = { 'desk.set': 0.96, 'desk.chief': 1.3 };

/** Blender (x, y, z) Z-up → glTF (x, z, −y) Y-up (§2: glTF +Z, the open front = Blender −Y). */
export const fromBlender = ([x, y, z]: readonly [number, number, number]): [number, number, number] => [x, z, -y || 0];

/** §3 seat: the penguin sits at desk-local Blender (0, +0.27, 0.42). */
export const SEAT_OFFSET = fromBlender([0, 0.27, 0.42]);
/** §3 lamp: back-left corner of the desk, Blender (−w/2 + 0.12, −0.02, 0.72). */
export const lampOffset = (desk: DeskModule): [number, number, number] => fromBlender([-DESK_WIDTH[desk] / 2 + 0.12, -0.02, 0.72]);

/** §2 penguin seated height (m). */
export const PENGUIN_HEIGHT = 0.6;

/** §4: kit materials are per-module instances `<palette key>#<module>`; the key is what the web paints. */
export const paletteKey = (materialName: string): string => materialName.split('#')[0];

/** Materials the web recolours by name per theme (§4). */
export const KIT_MATERIALS = [
  'clay.wall',
  'clay.floor',
  'clay.furniture',
  'clay.wood',
  'clay.plant',
  'clay.screen',
  'clay.lamp_bulb',
  'team_sticker',
] as const;

export const PENGUIN_MATERIALS = [
  'penguin.body',
  'penguin.face',
  'penguin.cheek',
  'penguin.eye',
  'penguin.beak',
  'penguin.feet',
  'team_accent',
] as const;

/** penguin.glb (§5). */
export const PENGUIN_MESH = 'penguin';
export const PENGUIN_RIG = 'penguin_rig';
export const BONES = ['root', 'body', 'head', 'wing.L', 'wing.R', 'foot.L', 'foot.R'] as const;
export const SOCKETS = ['head', 'chest', 'hand.R'] as const;
export type Socket = (typeof SOCKETS)[number];
export const socketBone = (s: Socket): string => `socket.${s}`;

/** Role props per agent id (§5 table) — `prop.<agent>.<part>`. Unknown roles wear the scarf. */
export const ROLE_PROPS: Record<string, readonly string[]> = {
  chief: ['crown', 'bowtie'],
  'product-manager': ['clipboard'],
  'product-designer': ['beret'],
  researcher: ['glasses'],
  'data-analyst': ['chart'],
  'frontend-engineer': ['beanie'],
  'backend-engineer': ['headset'],
  'data-engineer': ['cube'],
  infra: ['hardhat', 'shield'],
  'quality-assurance': ['magnifier'],
  'business-strategy': ['tie'],
  sales: ['card'],
  finance: ['glasses', 'calculator'],
  marketer: ['megaphone'],
  creative: ['brush'],
};
export const SCARF = 'prop.scarf';
export const propNode = (agent: string, part: string): string => `prop.${agent}.${part}`;
/** Every prop node penguin.glb must hold. */
export const ALL_PROPS: string[] = [
  ...Object.entries(ROLE_PROPS).flatMap(([agent, parts]) => parts.map((p) => propNode(agent, p))),
  SCARF,
];

/** Animation clips = state ids (§6). `idle_doze` is the evening's idle. */
export const CLIPS = ['idle', 'idle_doze', 'thinking', 'typing', 'waiting', 'done', 'error'] as const;
export type ClipName = (typeof CLIPS)[number];

/** §8 budget. */
export const BUDGET = {
  totalBytes: 5 * 1024 * 1024,
  extensions: ['EXT_meshopt_compression', 'EXT_texture_webp'],
  clipSeconds: [1, 2] as const,
  roughnessMin: 0.8,
};

// ------------------------------------------------------------------ the check

/** The part of a glTF JSON document the check reads (also `gltf.parser.json` at runtime). */
export interface GltfJson {
  asset?: { generator?: string };
  extensionsUsed?: string[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[]; extras?: Record<string, unknown> }[];
  meshes?: { name?: string; primitives: { material?: number }[] }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number };
    occlusionTexture?: { index: number; texCoord?: number };
  }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string; samplers: { input: number }[] }[];
  accessors?: { max?: number[] }[];
  images?: { mimeType?: string; uri?: string }[];
}

export type AssetKind = 'kit' | 'penguin';

export interface ContractReport {
  kind: AssetKind;
  /** What the web needs and the file lacks — the scene breaks or falls back without it. */
  missing: string[];
  /** Off-contract but the scene still runs (budget, matte look, optional anchors, AO). */
  warnings: string[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** The JSON chunk of a binary glTF (no geometry decode — names, extras and accessors' min/max). */
export function readGlbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic)');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('GLB has no JSON chunk first');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson;
}

function names<T extends { name?: string }>(list: T[] | undefined, key: (n: string) => string = (n) => n): Set<string> {
  return new Set((list ?? []).map((x) => key(x.name ?? '')).filter(Boolean));
}

/** Indices of the nodes under `root` (inclusive). */
function subtree(json: GltfJson, root: number): number[] {
  const out: number[] = [];
  const walk = (i: number) => {
    out.push(i);
    for (const c of json.nodes?.[i]?.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

function rootNodes(json: GltfJson): number[] {
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes) return scene.nodes;
  const child = new Set((json.nodes ?? []).flatMap((n) => n.children ?? []));
  return (json.nodes ?? []).map((_, i) => i).filter((i) => !child.has(i));
}

function materialsOf(json: GltfJson, nodeIdx: number[]): Set<number> {
  const out = new Set<number>();
  for (const i of nodeIdx) {
    const mesh = json.nodes?.[i]?.mesh;
    if (mesh === undefined) continue;
    for (const p of json.meshes?.[mesh]?.primitives ?? []) if (p.material !== undefined) out.add(p.material);
  }
  return out;
}

/** Materials that glow or get repainted per seat — no AO expected on them. */
const UNBAKED = new Set(['clay.screen', 'clay.lamp_bulb', 'team_sticker']);

function matteWarnings(json: GltfJson): string[] {
  const out: string[] = [];
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    // glTF defaults: metallic 1, roughness 1 — an unset metallicFactor is a metal
    const metal = pbr.metallicFactor ?? 1;
    const rough = pbr.roughnessFactor ?? 1;
    if (metal > 0) out.push(`material ${m.name ?? '?'}: metallic ${metal} (contract: 0)`);
    if (rough < BUDGET.roughnessMin) out.push(`material ${m.name ?? '?'}: roughness ${rough} (contract: ≥ ${BUDGET.roughnessMin})`);
  }
  return out;
}

function compressionWarnings(json: GltfJson): string[] {
  const out: string[] = [];
  const used = new Set(json.extensionsUsed ?? []);
  if (!used.has('EXT_meshopt_compression')) out.push('not meshopt-compressed (EXT_meshopt_compression)');
  const images = json.images ?? [];
  if (images.length && !used.has('EXT_texture_webp')) out.push('textures are not WebP (EXT_texture_webp)');
  for (const img of images) if (img.uri && !img.uri.startsWith('data:')) out.push(`external image ${img.uri} — embed it in the GLB`);
  return out;
}

export function checkGltf(json: GltfJson, kind: AssetKind): ContractReport {
  const missing: string[] = [];
  const warnings: string[] = [];
  const nodeNames = names(json.nodes);
  const materialNames = names(json.materials, paletteKey);
  const need = (what: string, list: readonly string[], have: Set<string>) => {
    for (const n of list) if (!have.has(n)) missing.push(`${what} ${n}`);
  };

  if (kind === 'kit') {
    const roots = new Map(rootNodes(json).map((i) => [json.nodes?.[i]?.name ?? '', i]));
    for (const m of MODULES) {
      if (roots.has(m)) continue;
      missing.push(nodeNames.has(m) ? `module ${m} is not a root node` : `module ${m}`);
    }
    if (!nodeNames.has(LAMP_LIGHT)) missing.push(`node ${LAMP_LIGHT}`);
    need('material', KIT_MATERIALS, materialNames);
    // baked AO (§7): every fixed module's materials should carry an occlusion map on uv_ao
    const noAo: string[] = [];
    const wrongUv: string[] = [];
    for (const m of MODULES) {
      const idx = roots.get(m);
      if (idx === undefined) continue;
      const mats = [...materialsOf(json, subtree(json, idx))].map((i) => json.materials?.[i]);
      if (mats.some((x) => x && !x.occlusionTexture && !UNBAKED.has(paletteKey(x.name ?? '')))) noAo.push(m);
      if (mats.some((x) => x?.occlusionTexture && (x.occlusionTexture.texCoord ?? 0) !== 1)) wrongUv.push(m);
    }
    if (noAo.length) warnings.push(`no baked AO (occlusionTexture) on ${noAo.join(', ')}`);
    if (wrongUv.length) warnings.push(`AO not on the second UV (uv_ao = TEXCOORD_1) on ${wrongUv.join(', ')}`);
  } else {
    if (!nodeNames.has(PENGUIN_MESH)) missing.push(`node ${PENGUIN_MESH}`);
    if (!nodeNames.has(PENGUIN_RIG)) missing.push(`node ${PENGUIN_RIG}`);
    const joints = new Set((json.skins ?? []).flatMap((s) => s.joints.map((j) => json.nodes?.[j]?.name ?? '')));
    const bones = [...BONES, ...SOCKETS.map(socketBone)];
    for (const b of bones) {
      if (!nodeNames.has(b)) missing.push(`bone ${b}`);
      else if (!joints.has(b) && !b.startsWith('socket.')) missing.push(`bone ${b} is not a joint of the penguin's skin`);
    }
    const mesh = (json.nodes ?? []).find((n) => n.name === PENGUIN_MESH);
    if (mesh && mesh.skin === undefined) missing.push(`node ${PENGUIN_MESH} is not skinned`);
    need('material', PENGUIN_MATERIALS, materialNames);
    for (const p of ALL_PROPS) {
      const node = (json.nodes ?? []).find((n) => n.name === p);
      if (!node) {
        missing.push(`prop ${p}`);
        continue;
      }
      const socket = node.extras?.socket;
      if (typeof socket !== 'string' || !(SOCKETS as readonly string[]).includes(socket)) {
        missing.push(`prop ${p}: custom property socket = ${SOCKETS.join(' | ')} (got ${socket === undefined ? 'none' : JSON.stringify(socket)})`);
      }
    }
    const clips = new Map((json.animations ?? []).map((a) => [a.name ?? '', a]));
    for (const c of CLIPS) {
      const clip = clips.get(c);
      if (!clip) {
        missing.push(`clip ${c}`);
        continue;
      }
      const length = Math.max(0, ...clip.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
      const [lo, hi] = BUDGET.clipSeconds;
      if (length < lo - 0.05 || length > hi + 0.05) warnings.push(`clip ${c}: ${length.toFixed(2)} s (contract: ${lo}–${hi} s)`);
    }
    for (const name of clips.keys()) if (!(CLIPS as readonly string[]).includes(name)) warnings.push(`clip ${name} is not a state id — the web ignores it`);
  }
  warnings.push(...matteWarnings(json), ...compressionWarnings(json));
  return { kind, missing, warnings };
}

/** Both files, plus the shared size budget. */
export function checkOfficeAssets(files: { kit?: Uint8Array; penguin?: Uint8Array }): ContractReport[] {
  const out: ContractReport[] = [];
  for (const kind of ['kit', 'penguin'] as const) {
    const bytes = files[kind];
    if (!bytes) {
      out.push({ kind, missing: [`file ${kind === 'kit' ? 'office-kit.glb' : 'penguin.glb'}`], warnings: [] });
      continue;
    }
    try {
      out.push(checkGltf(readGlbJson(bytes), kind));
    } catch (e) {
      out.push({ kind, missing: [`readable GLB (${e instanceof Error ? e.message : String(e)})`], warnings: [] });
    }
  }
  const total = (files.kit?.byteLength ?? 0) + (files.penguin?.byteLength ?? 0);
  if (total > BUDGET.totalBytes) out[0].warnings.push(`office-kit.glb + penguin.glb = ${(total / 1048576).toFixed(2)} MB (budget 5 MB)`);
  return out;
}

/** Plain-text summary (CLI · dev console). */
export function formatReport(reports: ContractReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    const file = r.kind === 'kit' ? 'office-kit.glb' : 'penguin.glb';
    lines.push(`${r.missing.length ? 'FAIL' : 'ok  '} ${file}`);
    for (const m of r.missing) lines.push(`  missing  ${m}`);
    for (const w of r.warnings) lines.push(`  warn     ${w}`);
  }
  return lines.join('\n');
}
