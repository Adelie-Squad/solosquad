// Building the office from the two GLBs (asset contract): clone the kit's modules onto the
// tiled room and the desk pods, clone a penguin per agent with its role props on the socket
// bones, and swap materials by name when the theme or a status changes — nothing reloads.
// three.js only (no React); part of the lazily loaded office chunk.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { teamColor } from '../characters/colors';
import { canonical } from '../characters/roster';
import { ANCHORS, CLIPS, LAMP_LIGHT, PENGUIN_MESH, ROLE_PROPS, SCARF, SOCKETS, propNode, socketBone, type ClipName, type ModuleName, type Socket } from './contract';
import { layoutOffice, PROP_SPOTS, propPlace, roomFor, roomTiles, type Footprint, type Room, type SeatAgent } from './layout';
import { CROSSFADE, clipFor, phaseOf, STILL_TIME } from './motion';
import type { ClayMaterial, OfficePalette } from './palette';
import type { AgentStatus } from './state';

/** Layer the fixed kit lives on — the contact-shadow camera sees layer 0 only, i.e. the penguins. */
export const KIT_LAYER = 1;

/** The name the asset gave a node — three strips `.` from `Object3D.name`, the original stays in userData. */
export const nameOf = (o: THREE.Object3D): string => (o.userData?.name as string | undefined) ?? o.name;

export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && nameOf(o) === name) hit = o;
  });
  return hit;
}

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

const matsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/** Swap every material named `name` on `root` for `next(material)`. */
function swap(root: THREE.Object3D, name: string, next: (m: THREE.Material) => THREE.Material): THREE.Mesh[] {
  const hit: THREE.Mesh[] = [];
  for (const mesh of meshes(root)) {
    if (Array.isArray(mesh.material)) {
      if (mesh.material.some((m) => m.name === name)) {
        mesh.material = mesh.material.map((m) => (m.name === name ? next(m) : m));
        hit.push(mesh);
      }
    } else if (mesh.material.name === name) {
      mesh.material = next(mesh.material);
      hit.push(mesh);
    }
  }
  return hit;
}

// ------------------------------------------------------------------ materials

type Std = THREE.MeshStandardMaterial;
const black = new THREE.Color(0, 0, 0);

/**
 * Every material the scene paints, by name. Base materials (shared by all clones) take the theme
 * colour in place; per-state and per-team looks are cached clones (`clay.screen|on`,
 * `team_sticker|product` …) so a status change is a pointer swap, not a new material.
 */
export class MaterialBank {
  private base = new Map<string, Std[]>();
  private variants = new Map<string, { name: string; variant: string; mat: Std }>();
  private palette: OfficePalette;

  constructor(roots: THREE.Object3D[], palette: OfficePalette) {
    this.palette = palette;
    for (const r of roots) {
      for (const mesh of meshes(r)) {
        for (const m of matsOf(mesh)) {
          const list = this.base.get(m.name) ?? [];
          if (!list.includes(m as Std)) list.push(m as Std);
          this.base.set(m.name, list);
        }
      }
    }
  }

  variant(source: THREE.Material, variant: string): Std {
    const key = `${source.name}|${variant}`;
    let v = this.variants.get(key);
    if (!v) {
      v = { name: source.name, variant, mat: (source as Std).clone() };
      v.mat.name = source.name;
      this.variants.set(key, v);
      this.paintVariant(v.name, v.variant, v.mat);
    }
    return v.mat;
  }

  setPalette(p: OfficePalette): void {
    this.palette = p;
    for (const [name, list] of this.base) for (const m of list) this.paintBase(name, m);
    for (const v of this.variants.values()) this.paintVariant(v.name, v.variant, v.mat);
  }

  private paintBase(name: string, m: Std): void {
    const p = this.palette;
    if (name in p.materials) m.color.set(p.materials[name as ClayMaterial]);
    if (name === 'penguin.body') m.color.set(p.penguinBody);
  }

  private paintVariant(name: string, variant: string, m: Std): void {
    const p = this.palette;
    this.paintBase(name, m);
    if (name === 'team_sticker' || name === 'team_accent') {
      m.color.set(teamColor(variant));
      return;
    }
    const glow = (on: boolean, color: string | null) => {
      if (m.emissive) {
        if (on && color) m.emissive.set(color);
        else m.emissive.copy(black);
        m.emissiveIntensity = on && color ? 1 : 0;
      }
    };
    if (name === 'clay.screen') {
      const on = variant === 'on' && !!p.screenGlow;
      if (on) m.color.set(p.screenGlow!);
      glow(on, p.screenGlow);
    } else if (name === 'clay.lamp_bulb') {
      const on = variant === 'on' && !!p.lamp;
      if (on) m.color.set(p.lamp!.bulb);
      glow(on, p.lamp?.bulb ?? null);
    } else if (name === 'penguin.body' && variant === 'dim') {
      m.color.lerp(black, p.idleDim);
    }
  }

  dispose(): void {
    for (const v of this.variants.values()) v.mat.dispose();
    this.variants.clear();
  }
}

// ------------------------------------------------------------------ the office

export interface Seat {
  name: string;
  team: string | null;
  desk: THREE.Object3D;
  penguin: THREE.Object3D;
  screens: THREE.Mesh[];
  bulbs: THREE.Mesh[];
  bodies: THREE.Mesh[];
  lamp: THREE.Object3D | null;
  pool: THREE.Mesh | null;
  /** The point the name tag hangs from (above the head). */
  tagAnchor: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<ClipName, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  status: AgentStatus | null;
  phase: number;
  tag: HTMLElement | null;
}

export interface Office {
  root: THREE.Group;
  room: Room;
  seats: Map<string, Seat>;
  dispose(): void;
}

interface Sources {
  kit: { scene: THREE.Object3D };
  penguin: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
}

/** Where a desk module puts its sitter and its lamp when the GLB has no anchor empties. */
const SEAT_DEFAULT = new THREE.Vector3(0, 0.45, -0.35);
const LAMP_DEFAULT = (fp: Footprint) => new THREE.Vector3(-fp.w * 0.36, 0.72, fp.d * 0.12);

/** A module's floor footprint at rest (origin and rotation reset — modules may sit anywhere in the kit file). */
export function footprint(module: THREE.Object3D | null, fallback: Footprint): Footprint {
  if (!module) return fallback;
  const c = module.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c);
  if (box.isEmpty()) return fallback;
  const s = box.getSize(new THREE.Vector3());
  return { w: s.x, d: s.z };
}

function place(module: THREE.Object3D, parent: THREE.Object3D, x: number, z: number, rotY = 0): THREE.Object3D {
  const c = module.clone(true);
  c.position.set(x, 0, z);
  c.rotation.set(0, rotY, 0);
  parent.add(c);
  return c;
}

let poolAlpha: THREE.DataTexture | null = null;
/** A soft round alpha (no colour) for the lamp's light pool. */
function poolTexture(): THREE.DataTexture {
  if (poolAlpha) return poolAlpha;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - r) ** 1.6;
      const v = Math.round(a * 255);
      data.set([v, v, v, 255], (y * n + x) * 4);
    }
  }
  poolAlpha = new THREE.DataTexture(data, n, n);
  poolAlpha.needsUpdate = true;
  return poolAlpha;
}

export function buildOffice(src: Sources, agents: SeatAgent[], bank: MaterialBank, aspect: number): Office {
  const root = new THREE.Group();
  const kitRoot = new THREE.Group();
  root.add(kitRoot);
  const mod = (name: ModuleName) => findNode(src.kit.scene, name);
  const deskSet = mod('desk.set');
  const chiefSet = mod('desk.chief') ?? deskSet;
  const deskFp = footprint(deskSet, { w: 1.3, d: 1.5 });
  const chiefFp = footprint(chiefSet, { w: 1.7, d: 1.7 });
  const pods = layoutOffice(agents, { aspect, desk: deskFp, chiefDesk: chiefFp });
  const room = roomFor(pods);
  const tiles = roomTiles(room);

  const floor = mod('room.floor_tile');
  const wallLeft = mod('room.wall_left');
  const wallBack = mod('room.wall_back');
  const corner = mod('room.corner');
  if (floor) for (const t of tiles.floor) place(floor, kitRoot, t.x, t.z);
  if (wallLeft) for (const t of tiles.wallLeft) place(wallLeft, kitRoot, t.x, t.z);
  if (wallBack) for (const t of tiles.wallBack) place(wallBack, kitRoot, t.x, t.z);
  if (corner) place(corner, kitRoot, tiles.corner.x, tiles.corner.z);
  for (const spot of PROP_SPOTS) {
    const m = mod(spot.module);
    if (!m) continue;
    const at = propPlace(spot, room, footprint(m, { w: 1, d: 0.6 }));
    place(m, kitRoot, at.x, at.z, at.rotY);
  }

  const lampModule = mod('lamp.desk');
  const seats = new Map<string, Seat>();
  const clips = new Map(src.penguin.animations.map((c) => [c.name as ClipName, c]));
  const v = new THREE.Vector3();
  let index = 0;
  for (const pod of pods) {
    for (const d of pod.desks) {
      const module = d.chief ? chiefSet : deskSet;
      if (!module) continue;
      const desk = place(module, kitRoot, d.x, d.z);
      desk.updateMatrixWorld(true);
      const deskName = d.chief && mod('desk.chief') ? 'desk.chief' : 'desk.set';
      const seatAt = findNode(desk, deskName + ANCHORS.seat)?.getWorldPosition(new THREE.Vector3()) ?? desk.localToWorld(SEAT_DEFAULT.clone());
      const lampAt = findNode(desk, deskName + ANCHORS.lamp)?.getWorldPosition(new THREE.Vector3()) ?? desk.localToWorld(LAMP_DEFAULT(d.chief ? chiefFp : deskFp));
      const team = d.team ?? '';
      swap(desk, 'team_sticker', (m) => bank.variant(m, team));
      const screens = swap(desk, 'clay.screen', (m) => m);

      let lamp: THREE.Object3D | null = null;
      let pool: THREE.Mesh | null = null;
      const bulbs: THREE.Mesh[] = [];
      if (lampModule) {
        lamp = place(lampModule, kitRoot, lampAt.x, lampAt.z);
        lamp.position.y = lampAt.y;
        bulbs.push(...swap(lamp, 'clay.lamp_bulb', (m) => m));
        lamp.updateMatrixWorld(true);
        const light = findNode(lamp, LAMP_LIGHT);
        const at = light ? light.getWorldPosition(v) : lamp.getWorldPosition(v);
        pool = new THREE.Mesh(
          new THREE.CircleGeometry(0.55, 32),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, alphaMap: poolTexture(), toneMapped: false }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(at.x + 0.12, lampAt.y + 0.004, at.z);
        pool.renderOrder = 2;
        kitRoot.add(pool);
      }

      // the penguin — one shared body; this agent's props stay, the rest go
      const penguin = cloneSkinned(src.penguin.scene);
      penguin.position.copy(seatAt);
      penguin.rotation.set(0, 0, 0);
      root.add(penguin);
      penguin.updateMatrixWorld(true);
      dressPenguin(penguin, d.agent);
      swap(penguin, 'team_accent', (m) => bank.variant(m, team));
      const bodies = swap(penguin, 'penguin.body', (m) => m);
      for (const mesh of meshes(penguin)) mesh.frustumCulled = false; // skinned bounds lag the pose

      const head = findNode(penguin, socketBone('head')) ?? findNode(penguin, 'head') ?? penguin;
      const tagAnchor = new THREE.Object3D();
      tagAnchor.position.set(0, 0.3, 0);
      head.add(tagAnchor);

      const mixer = new THREE.AnimationMixer(penguin);
      const actions = new Map<ClipName, THREE.AnimationAction>();
      for (const c of CLIPS) {
        const clip = clips.get(c);
        if (clip) actions.set(c, mixer.clipAction(clip));
      }
      for (const o of [desk, penguin]) o.traverse((x) => (x.userData.agent = d.agent));
      if (lamp) lamp.traverse((x) => (x.userData.agent = d.agent));

      seats.set(d.agent, {
        name: d.agent,
        team: d.team,
        desk,
        penguin,
        screens,
        bulbs,
        bodies,
        lamp,
        pool,
        tagAnchor,
        mixer,
        actions,
        current: null,
        status: null,
        phase: phaseOf(d.agent, index++),
        tag: null,
      });
    }
  }
  kitRoot.traverse((o) => o.layers.set(KIT_LAYER));
  for (const m of meshes(kitRoot)) m.receiveShadow = false;

  return {
    root,
    room,
    seats,
    dispose() {
      for (const s of seats.values()) {
        s.mixer.stopAllAction();
        s.mixer.uncacheRoot(s.penguin);
        s.pool?.geometry.dispose();
        (s.pool?.material as THREE.Material | undefined)?.dispose();
      }
      root.clear();
    },
  };
}

/** Keep this agent's role props (or the team scarf) and hang them on their socket bones. */
export function dressPenguin(penguin: THREE.Object3D, agent: string): string[] {
  const id = canonical(agent);
  const parts = ROLE_PROPS[id];
  const wanted = parts?.map((p) => propNode(id, p)).filter((n) => findNode(penguin, n)) ?? [];
  const keep = new Set(parts && wanted.length === parts.length ? wanted : [SCARF]);
  const props: THREE.Object3D[] = [];
  penguin.traverse((o) => {
    const n = nameOf(o);
    if (n.startsWith('prop.') && n !== PENGUIN_MESH) props.push(o);
  });
  for (const p of props) {
    if (!keep.has(nameOf(p))) {
      p.removeFromParent();
      continue;
    }
    // a skinned prop already follows the rig; a rigid one is attached to its socket bone at rest
    if ((p as THREE.SkinnedMesh).isSkinnedMesh) continue;
    const socket = p.userData.socket as Socket | undefined;
    const bone = socket && (SOCKETS as readonly string[]).includes(socket) ? findNode(penguin, socketBone(socket)) : null;
    if (bone && p.parent !== bone) bone.attach(p);
  }
  return [...keep];
}

/** Lamps, screens and the idle dim follow the status and theme (evening only — day keeps lamps away). */
export function applyLook(seat: Seat, status: AgentStatus, palette: OfficePalette, bank: MaterialBank): void {
  const working = status !== 'idle';
  const evening = !!palette.lamp;
  const screenOn = evening ? working : true;
  for (const m of seat.screens) swap(m, 'clay.screen', (x) => bank.variant(x, screenOn ? 'on' : 'off'));
  for (const m of seat.bulbs) swap(m, 'clay.lamp_bulb', (x) => bank.variant(x, evening && working ? 'on' : 'off'));
  for (const m of seat.bodies) swap(m, 'penguin.body', (x) => bank.variant(x, evening && !working ? 'dim' : 'lit'));
  if (seat.lamp) seat.lamp.visible = evening;
  if (seat.pool) {
    seat.pool.visible = evening && working;
    const mat = seat.pool.material as THREE.MeshBasicMaterial;
    if (palette.lamp) mat.color.set(palette.lamp.pool);
    mat.opacity = palette.lamp?.poolOpacity ?? 0;
  }
}

/** Blend to the state's clip (0.25 s), starting each agent at its own phase; reduced motion holds the first frame. */
export function playStatus(seat: Seat, status: AgentStatus, evening: boolean, reduced: boolean): void {
  const name = clipFor(status, evening, (c) => seat.actions.has(c));
  const next = seat.actions.get(name) ?? seat.actions.get('idle') ?? null;
  seat.status = status;
  if (!next) return;
  if (next === seat.current) {
    if (reduced) {
      next.time = STILL_TIME;
      seat.mixer.update(0);
    }
    return;
  }
  const prev = seat.current;
  next.reset();
  next.time = reduced ? STILL_TIME : seat.phase * next.getClip().duration;
  next.setEffectiveWeight(1);
  next.play();
  if (prev && !reduced) next.crossFadeFrom(prev, CROSSFADE, false);
  else prev?.stop();
  seat.current = next;
  if (reduced) seat.mixer.update(0);
}
