// The keycap diorama office (DESIGN.md `## 사무실 장면`, guide §2–§9) — three.js directly,
// no React Three Fiber. Loaded only on the office screen (dynamic import from OfficeStage).
//
// Five look rules: face-direction 3 tones · two-weight ink lines in post · one flat shadow
// colour · the palette only · no walls. Theme switches recolour uniforms; nothing reloads.
import * as THREE from 'three';
import { PENGUIN_2D, TEAM_COLORS, teamColor } from '../characters/colors';
import { lookOf } from '../characters/roster';
import { box, cap, cyl, disposeShared, penguinBody, sph } from './geometry';
import { AGENT_BACK, bounds, ENTRY, ISLAND_H, layoutOffice, type Island, type SeatAgent } from './layout';
import { bodyMaterial, inkComposite, recolorBody, ToneMaterials, toneFrom, type BodyColors } from './materials';
import { ease, REST, STILL, target, type Pose } from './motion';
import { paletteFor, type OfficePalette, type Tone3 } from './palette';
import { addProp, type ToneKey } from './props';
import type { AgentStatus } from './state';
import type { Theme } from '../theme';

export interface SceneOptions {
  theme: Theme;
  reducedMotion: boolean;
  mobile: boolean;
  onSelect?: (agent: string) => void;
}

interface Seat {
  name: string;
  team: string | null;
  root: THREE.Group;
  rig: THREE.Group;
  wings: THREE.Group[];
  eyes: THREE.Mesh[];
  body: THREE.ShaderMaterial;
  screen: THREE.MeshBasicMaterial;
  lamp: THREE.Group;
  pool: THREE.Mesh;
  status: AgentStatus;
  pose: Pose;
  phase: number;
  blinkAt: number;
  tag: HTMLElement | null;
}

const DESK = { w: 1.35, h: 0.42, d: 0.72 };

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private tones = new ToneMaterials();
  private shadowMat = new THREE.ShadowMaterial();
  private normalMat = new THREE.MeshNormalMaterial();
  private rtColor: THREE.WebGLRenderTarget;
  private rtNormal: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ink: ReturnType<typeof inkComposite>;
  private world = new THREE.Group();
  /** Things that must not draw ink lines (light pools): hidden in the normal pass. */
  private noInk: THREE.Object3D[] = [];
  private seats = new Map<string, Seat>();
  private palette: OfficePalette;
  private theme: Theme;
  private reduced: boolean;
  private pr: number;
  private width = 1;
  private height = 1;
  private frame = 0;
  private running = false;
  private visible = true;
  private onScreen = true;
  private last = 0;
  private time = 0;
  private dirty = true;
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector3();
  private onSelect?: (agent: string) => void;
  /** Frames drawn in the last second — read by the stage for a rough frame rate. */
  fps = 0;
  private fpsCount = 0;
  private fpsAt = 0;

  constructor(private canvas: HTMLCanvasElement, opts: SceneOptions) {
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.pr = opts.mobile ? 1.5 : 2;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.theme = opts.theme;
    this.palette = paletteFor(opts.theme);
    this.reduced = opts.reducedMotion;
    this.onSelect = opts.onSelect;

    const size = opts.mobile ? 2048 : 4096;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.012;
    this.scene.add(this.sun, this.sun.target, this.world);

    this.rtColor = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
    this.rtNormal = new THREE.WebGLRenderTarget(4, 4);
    this.ink = inkComposite(this.rtColor.texture, this.rtNormal.texture, this.rtColor.depthTexture!, this.camera.near, this.camera.far, this.palette.ink);
    this.ink.uniforms.uThick.value = 1.45 * this.pr;
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.ink.material));

    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('pointerup', this.onPointer);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.applyPalette();
  }

  // ------------------------------------------------------------------ public

  /** Rebuild the seating when the set of agents or teams changes. */
  setAgents(agents: SeatAgent[]): void {
    const key = (list: SeatAgent[]) => list.map((a) => `${a.name}@${a.team ?? ''}`).sort().join('|');
    const now = [...this.seats.values()].map((s) => ({ name: s.name, team: s.team }));
    if (key(now) === key(agents) && this.seats.size) return;
    const keepTags = new Map([...this.seats].map(([n, s]) => [n, s.tag]));
    const keepStatus = new Map([...this.seats].map(([n, s]) => [n, s.status]));
    this.clearWorld();
    const islands = layoutOffice(agents);
    islands.forEach((island) => this.buildIsland(island));
    for (const [name, seat] of this.seats) {
      seat.tag = keepTags.get(name) ?? null;
      seat.status = keepStatus.get(name) ?? 'idle';
    }
    this.frameCamera(islands);
    this.applyStatuses();
    this.touch();
  }

  setStatuses(statuses: Record<string, AgentStatus>): void {
    for (const [name, seat] of this.seats) seat.status = statuses[name] ?? 'idle';
    this.applyStatuses();
    this.touch();
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.palette = paletteFor(theme);
    this.applyPalette();
    this.applyStatuses();
    this.touch();
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.touch();
  }

  /** Where each agent's name tag goes (HTML overlay — 3D text breaks Hangul and Chinese). */
  setTag(name: string, el: HTMLElement | null): void {
    const seat = this.seats.get(name);
    if (seat) seat.tag = el;
    this.touch();
  }

  setOnScreen(on: boolean): void {
    this.onScreen = on;
    this.kick();
  }

  resize(w: number, h: number): void {
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.rtColor.setSize(w * this.pr, h * this.pr);
    this.rtNormal.setSize(w * this.pr, h * this.pr);
    this.ink.uniforms.uTexel.value.set(1 / (w * this.pr), 1 / (h * this.pr));
    this.fitFrustum();
    this.dirty = true;
    this.kick();
  }

  start(): void {
    this.running = true;
    this.kick();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('pointerup', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearWorld();
    this.tones.dispose();
    disposeShared();
    this.rtColor.dispose();
    this.rtNormal.dispose();
    this.ink.material.dispose();
    this.normalMat.dispose();
    this.shadowMat.dispose();
    this.renderer.dispose();
  }

  /** Context lost after start (driver reset, too many contexts) — the stage falls back to the list. */
  onFail?: () => void;

  // ------------------------------------------------------------------ build

  private tone(key: string): THREE.ShaderMaterial {
    return this.tones.get(key, this.toneFor(key));
  }

  private toneFor(key: string): Tone3 {
    const p = this.palette;
    if (key.startsWith('team:')) return toneFrom(teamColor(key.slice(5)));
    switch (key) {
      case 'block':
        return p.block;
      case 'white':
        return p.white;
      case 'black':
        return p.black;
      case 'plant':
        return p.plant;
      case 'point':
        return p.point;
      case 'lens':
        return p.lens;
      case 'eye':
        return p.penguin.eye;
      case 'cheek':
        return p.penguin.cheek;
      case 'pbody':
        return p.penguin.body;
      case 'pface':
        return p.penguin.face;
      case 'gold':
        return toneFrom(TEAM_COLORS.core);
      case 'helmet':
        return toneFrom(PENGUIN_2D.helmet);
      default:
        return p.block;
    }
  }

  private mk(geo: THREE.BufferGeometry, mat: THREE.Material | string, pos: [number, number, number], parent: THREE.Object3D, opts: { rot?: [number, number, number]; scale?: [number, number, number]; cast?: boolean } = {}): THREE.Mesh {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? this.tone(mat) : mat);
    m.castShadow = opts.cast !== false;
    m.position.set(...pos);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    parent.add(m);
    return m;
  }

  private shadowPlane(w: number, d: number, x: number, y: number, z: number): void {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.world.add(m);
  }

  private buildIsland(island: Island): void {
    const g = new THREE.Group();
    this.world.add(g);
    this.mk(cap(island.w, ISLAND_H, island.d, 0.5, 0.25, 0.09), 'block', [island.x, 0, island.z], g);
    this.shadowPlane(island.w - 0.75, island.d - 0.75, island.x, ISLAND_H + 0.004, island.z);
    // a plant on a free corner of every island — the diorama's life (palette: plant)
    const px = island.x + island.w / 2 - 0.45;
    const pz = island.z - island.d / 2 + 0.45;
    this.mk(cyl(0.025, 0.035, 0.4, 8), 'black', [px, ISLAND_H + 0.2, pz], g);
    this.mk(cap(0.36, 0.48, 0.36, 0.17, 0, 0.05), 'plant', [px, ISLAND_H + 0.36, pz], g);
    island.desks.forEach((desk, i) => this.buildSeat(desk.agent, desk.team, desk.x, desk.z, g, i));
  }

  private buildSeat(name: string, team: string | null, x: number, z: number, parent: THREE.Group, index: number): void {
    const look = lookOf(name, team);
    const teamKey = `team:${look.team}`;
    const y = ISLAND_H;
    // desk + laptop; the lid's back faces the camera, its sticker is the team colour
    this.mk(cap(DESK.w, DESK.h, DESK.d, 0.14, 0.05, 0.05), 'block', [x, y, z], parent);
    this.mk(cap(0.56, 0.035, 0.36, 0.04, 0, 0.012), 'black', [x, y + DESK.h, z - 0.05], parent);
    const hinge = new THREE.Group();
    hinge.position.set(x, y + 0.455, z + 0.12);
    hinge.rotation.x = -0.42;
    parent.add(hinge);
    this.mk(cap(0.56, 0.3, 0.03, 0.04, 0, 0.01), 'white', [0, 0, 0], hinge);
    this.mk(cyl(0.05, 0.05, 0.012, 24), teamKey, [0.12, 0.18, 0.02], hinge, { rot: [Math.PI / 2, 0, 0] });
    // the screen side (towards the penguin) — glows in the evening
    const screen = new THREE.MeshBasicMaterial({ color: this.palette.screen });
    this.mk(box(0.5, 0.25, 0.004), screen, [0, 0.16, -0.018], hinge, { cast: false });

    // desk lamp — evening only: lit for working agents, with a warm pool on desk and floor
    const lamp = new THREE.Group();
    lamp.position.set(x - 0.5, y + DESK.h, z - 0.12);
    parent.add(lamp);
    this.mk(cyl(0.012, 0.012, 0.42, 8), 'black', [0, 0.21, 0], lamp);
    this.mk(new THREE.ConeGeometry(0.1, 0.1, 18, 1, true), 'black', [0.06, 0.43, 0.02], lamp, { rot: [0, 0, 0.5] });
    const bulb = new THREE.MeshBasicMaterial({ color: this.palette.lamp?.bulb ?? this.palette.screen });
    this.mk(sph(0.045, 12, 8), bulb, [0.07, 0.4, 0.02], lamp, { cast: false });
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 40),
      new THREE.MeshBasicMaterial({ color: this.palette.lamp?.pool ?? this.palette.screen, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x - 0.2, y + DESK.h + 0.006, z - 0.25);
    pool.scale.set(1, 0.75, 1);
    parent.add(pool);
    this.noInk.push(pool);

    // the penguin — one shared body, the role's prop attached
    const root = new THREE.Group();
    root.position.set(x, y, z - AGENT_BACK);
    root.rotation.y = 0.28;
    parent.add(root);
    const rig = new THREE.Group();
    root.add(rig);
    const body = bodyMaterial(this.bodyColors());
    this.mk(penguinBody(), body, [0, 0, 0], rig);
    const eyes: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      eyes.push(this.mk(sph(0.09, 24, 16), 'eye', [s * 0.155, 0.86, 0.275], rig, { scale: [0.95, 1.22, 0.42] }));
      this.mk(sph(0.07, 20, 12), 'cheek', [s * 0.27, 0.69, 0.25], rig, { scale: [1.25, 0.85, 0.35] });
      this.mk(sph(0.12, 20, 12), 'pbody', [s * 0.17, 0.04, 0.13], rig, { scale: [1.05, 0.42, 1.3] });
    }
    this.mk(new THREE.OctahedronGeometry(0.075), 'pface', [0, 0.73, 0.315], rig, { scale: [1.2, 0.8, 0.62] });
    const wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.41, 0.74, 0);
      rig.add(pivot);
      this.mk(sph(0.22, 24, 16), 'pbody', [s * 0.05, -0.19, 0], pivot, { scale: [0.32, 1, 0.55] });
      return pivot;
    });
    const toneOf = (k: ToneKey) => (k === 'team' ? teamKey : k);
    addProp(look.prop, rig, wings[1], (geo, k, pos, par, opts) => this.mk(geo, toneOf(k), pos, par, opts));
    root.traverse((o) => (o.userData.agent = name));
    hinge.traverse((o) => (o.userData.agent = name));

    this.seats.set(name, {
      name,
      team,
      root,
      rig,
      wings,
      eyes,
      body,
      screen,
      lamp,
      pool,
      status: 'idle',
      pose: { ...REST },
      phase: index * 1.9 + name.length * 0.37,
      blinkAt: 1 + Math.random() * 3,
      tag: null,
    });
  }

  private clearWorld(): void {
    this.world.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.Material;
        if (m instanceof THREE.MeshBasicMaterial) m.dispose();
        if (m instanceof THREE.ShaderMaterial && m.uniforms.uGlow) m.dispose(); // per-penguin bodies
        if (o.geometry instanceof THREE.PlaneGeometry || o.geometry instanceof THREE.CircleGeometry) o.geometry.dispose();
      }
    });
    this.world.clear();
    this.noInk = [];
    this.seats.clear();
  }

  private bodyColors(): BodyColors {
    const p = this.palette;
    return { body: p.penguin.body, face: p.penguin.face, ink: p.ink, stitch: p.penguin.stitch, glowColor: p.screen };
  }

  // ------------------------------------------------------------------ palette · status

  private applyPalette(): void {
    const p = this.palette;
    this.scene.background = new THREE.Color(p.floor);
    this.shadowMat.color.set(p.shadow.color);
    this.shadowMat.opacity = p.shadow.opacity;
    (this.ink.uniforms.uInk.value as THREE.Color).set(p.ink);
    this.tones.recolor((key) => this.toneFor(key));
    for (const seat of this.seats.values()) recolorBody(seat.body, this.bodyColors());
    this.placeSun();
  }

  /** Lamps, screens and dimming follow the status (evening); day keeps the lamps away. */
  private applyStatuses(): void {
    const p = this.palette;
    for (const seat of this.seats.values()) {
      const lit = seat.status !== 'idle';
      const lampOn = !!p.lamp && lit;
      seat.lamp.visible = !!p.lamp;
      seat.pool.visible = lampOn;
      const bulb = (seat.lamp.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      bulb.color.set(lampOn && p.lamp ? p.lamp.bulb : p.black[1]);
      if (p.lamp) (seat.pool.material as THREE.MeshBasicMaterial).color.set(p.lamp.pool);
      (seat.pool.material as THREE.MeshBasicMaterial).opacity = p.lamp?.poolOpacity ?? 0;
      const screenOn = !p.lamp || lit;
      seat.screen.color.set(screenOn ? p.screen : p.black[1]);
      seat.body.uniforms.uGlow.value = p.lamp && lit ? p.glow : 0;
      seat.body.uniforms.uDim.value = p.lamp && !lit ? p.idleDim : 0;
    }
  }

  private placeSun(): void {
    const [sx, sy, sz] = this.palette.sun;
    this.sun.position.set(this.center.x + sx, sy, this.center.z + sz);
    this.sun.target.position.copy(this.center);
  }

  private frameCamera(islands: Island[]): void {
    const b = bounds(islands);
    this.center.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.camera.position.set(this.center.x + 10, 8.6, this.center.z + 10);
    this.camera.lookAt(this.center.x, 0.8, this.center.z);
    this.camera.updateMatrixWorld();
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 4;
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 60 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.placeSun();
    this.extent = b;
    this.fitFrustum();
  }

  private extent = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };

  /** Fit the orthographic frustum to the diorama's projected corners, keeping the aspect. */
  private fitFrustum(): void {
    const b = this.extent;
    const view = this.camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [b.minX, b.maxX]) {
      for (const z of [b.minZ, b.maxZ]) {
        for (const y of [0, ISLAND_H + 1.9]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(view);
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
      }
    }
    const pad = 0.6;
    let w = maxX - minX + pad * 2;
    let h = maxY - minY + pad * 2;
    const aspect = this.width / this.height;
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    Object.assign(this.camera, { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 });
    this.camera.updateProjectionMatrix();
    // a render-target pixel in world units — depth steps on slopes grow with it
    const unit = w / (this.width * this.pr);
    this.ink.uniforms.uDepthEdge.value = Math.max(0.14, unit * this.ink.uniforms.uThick.value * 4); // measured: 0.3 at 0.026 u/px
    // name tags shrink with the scene so a full office stays readable
    const pxPerUnit = this.width / w;
    this.tagScale = Math.min(1, Math.max(0.62, pxPerUnit / 70));
  }

  private tagScale = 1;

  // ------------------------------------------------------------------ loop

  private touch(): void {
    this.dirty = true;
    this.kick();
  }

  private kick(): void {
    if (!this.running || this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (!this.running || !this.visible || !this.onScreen) return; // resumes on visibility / intersection
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const moving = !this.reduced;
    if (moving) {
      this.time += dt;
      this.animate(dt);
    } else if (this.dirty) {
      this.settle();
    }
    if (moving || this.dirty) {
      this.render();
      this.dirty = false;
    }
    this.countFrame(now);
    if (moving) this.frame = requestAnimationFrame(this.tick);
  };

  private countFrame(now: number): void {
    this.fpsCount++;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsAt || 1000));
      this.fpsCount = 0;
      this.fpsAt = now;
    }
  }

  private animate(dt: number): void {
    const evening = !!this.palette.lamp;
    for (const seat of this.seats.values()) {
      seat.pose = ease(seat.pose, target(seat.status, this.time, seat.phase, evening), dt);
      this.pose(seat);
      let open = 1;
      const dozing = evening && seat.status === 'idle';
      if (dozing) open = 0.3;
      else if (this.time > seat.blinkAt) {
        open = 0.12;
        if (this.time > seat.blinkAt + 0.13) seat.blinkAt = this.time + 2.6 + Math.random() * 2.4;
      }
      for (const e of seat.eyes) {
        e.scale.y = 1.22 * open;
        e.position.y = 0.86 + seat.pose.look;
      }
    }
  }

  /** Reduced motion: jump straight to each state's still pose. */
  private settle(): void {
    for (const seat of this.seats.values()) {
      seat.pose = { ...STILL[seat.status] };
      this.pose(seat);
      for (const e of seat.eyes) {
        e.scale.y = 1.22;
        e.position.y = 0.86 + seat.pose.look;
      }
    }
  }

  private pose(seat: Seat): void {
    const m = seat.pose;
    seat.rig.position.y = m.hop;
    seat.rig.rotation.x = m.lean;
    seat.rig.rotation.z = m.sway;
    seat.rig.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6);
    seat.wings[0].rotation.z = -m.wl;
    seat.wings[1].rotation.z = m.wr;
    seat.wings[0].rotation.x = m.wfx;
    seat.wings[1].rotation.x = m.wfx;
  }

  private v = new THREE.Vector3();

  private render(): void {
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtColor);
    r.render(this.scene, this.camera);
    const bg = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = this.normalMat;
    for (const o of this.noInk) o.visible = false;
    r.setClearColor(0x8080ff, 1);
    r.setRenderTarget(this.rtNormal);
    r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.applyStatuses(); // restores pool visibility
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    this.placeTags();
  }

  private placeTags(): void {
    for (const seat of this.seats.values()) {
      if (!seat.tag) continue;
      seat.root.getWorldPosition(this.v);
      this.v.y += 1.55 + seat.rig.position.y;
      this.v.project(this.camera);
      const x = ((this.v.x + 1) / 2) * this.width;
      const y = ((1 - this.v.y) / 2) * this.height;
      seat.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${this.tagScale.toFixed(2)})`;
    }
  }

  // ------------------------------------------------------------------ events

  private onPointer = (e: PointerEvent): void => {
    if (!this.onSelect) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.children, true).find((h) => h.object.userData.agent);
    if (hit) this.onSelect(hit.object.userData.agent as string);
  };

  private onVisibility = (): void => {
    this.visible = document.visibilityState !== 'hidden';
    this.kick();
  };

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.running = false;
    this.onFail?.();
  };
}

export { ENTRY };
