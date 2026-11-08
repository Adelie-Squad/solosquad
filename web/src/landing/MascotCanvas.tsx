// The landing's 3D mascot — the lazily loaded part (three.js · R3F · drei · penguin.glb). One
// plain penguin from the office loader (office/penguinAsset.ts), coloured by the office palette
// (light = day, dark = evening overtime), playing the office's state clips. On top of the clip it
// acts on the section's content (DESIGN.md `## 랜딩` — 연기): each frame it reads the HTML act's
// marks (Acts.tsx — `data-hand` · `data-stamp-target` · `data-rod` · `data-front`), turns its
// wings to touch them (rig.ts), holds its props (props.ts) and cuts the body out behind the content
// so the content reads in front of it while a wing or a prop stays on top. The head follows the
// cursor. MascotStage owns the page side.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Theme } from '../theme';
import type { ClipName } from '../office/contract';
import { findNode, nameOf } from '../office/kit';
import { CROSSFADE } from '../office/motion';
import { paletteFor } from '../office/palette';
import { preloadPenguin, useSoloPenguin } from '../office/penguinAsset';
import { SkyLight } from '../office/SkyLight';
import { ACT_CLIP, cues, FLIP_STEP_MS, flipLift, now, squashAt, STAMP_TOTAL_MS, stampAside, stampLift, stampTilt, tapPulse } from './acting';
import { drawState, follow, lookAt, wander, type Look, type Pointer } from './gaze';
import { useHolder } from './holder';
import { makeRod, makeStamp, STAMP_LENGTH } from './props';
import { aim, atDepth, fitEraser, makeEraser, rayAt, reach } from './rig';
import type { SectionId } from './sections';

preloadPenguin();

export type { Pointer };

export interface LandingStats {
  fps: number;
  /** Last frame's draw calls — 0 means nothing is on screen. */
  calls: number;
  /** Where the shoulders and the resting wing tips fall in the canvas (0 = top … 1 = bottom) — tuning `--front-top`. */
  frame?: { shoulder: number; tip: number; feet: number; head: number };
}

export interface MascotCanvasProps {
  /** The section on stage — which act. */
  act: SectionId;
  /** Acting on the content (otherwise the clip alone, the wings at rest). */
  acting: boolean;
  theme: Theme;
  mobile: boolean;
  paused: boolean;
  pointer: RefObject<Pointer | null>;
  /** No cursor (touch): a slow look around instead of following. */
  touch: boolean;
  /** The pinned stage holding the slides and their marks. */
  pin: RefObject<HTMLElement | null>;
  onReady: () => void;
  onFail: () => void;
  stats?: LandingStats;
}

/** How much of the canvas height the penguin takes, and the height (× its own) at the canvas middle. */
const FRAME_HEIGHT = 1.6;
const FRAME_CENTRE = 0.6;
/** Body turn while acting (rad) — the wings stay on the content whatever the body does. */
const ACT_BODY = 0.35;
/** The head looks down at the content a little while acting (rad). */
const ACT_PITCH = 0.12;
/** Offsets on the page, as fractions of the canvas height. */
const HOVER = 0.012;
const TAP_DOWN = 0.022;
const FLIP_UP = 0.05;
/** The wings glide between marks at this rate (1/s) — taps and the stamp ride on top, undamped. */
const GLIDE = 11;
/** How far aside of the button the stamp is held at rest (fraction of the canvas height). */
const STAMP_ASIDE = 0.075;

export default function MascotCanvas(props: MascotCanvasProps) {
  const { onFail } = props;
  return (
    <Canvas
      className="landing-canvas"
      // above the content but never in the way of a click (R3F sets pointer-events inline otherwise)
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
      flat
      dpr={props.mobile ? 1.5 : Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)}
      frameloop={props.paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ fov: 26, near: 0.05, far: 20, position: [0, 0.35, 3] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          onFail();
        });
      }}
    >
      <Suspense fallback={null}>
        <Mascot {...props} />
      </Suspense>
    </Canvas>
  );
}

/**
 * The solo penguin is shared by every mount, so like its holder (holder.ts) its own body material
 * is set up after commit, idempotently — never during render.
 */
function useOwnBodyMaterial(penguin: THREE.Object3D, color: string) {
  useLayoutEffect(() => {
    penguin.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        if (!m.name.startsWith('penguin.body')) return m;
        // the office shares the source material — clone it once, then keep the clone
        const own = m.userData.landing ? (m as THREE.MeshStandardMaterial) : (m as THREE.MeshStandardMaterial).clone();
        own.userData.landing = true;
        own.color.set(color);
        return own;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
  }, [penguin, color]);
}

/** A bone turned on top of whatever the clip wrote this frame, undone before the next mix. */
class Offset {
  private q = new THREE.Quaternion();
  private inv = new THREE.Quaternion();
  constructor(readonly bone: THREE.Object3D | null) {}
  undo() {
    if (this.bone) this.bone.quaternion.multiply(this.inv);
  }
  apply(q: THREE.Quaternion) {
    if (!this.bone) return;
    this.q.copy(q);
    this.inv.copy(q).invert();
    this.bone.quaternion.multiply(this.q);
  }
}

type Side = 'L' | 'R';
interface Wing {
  bone: THREE.Object3D | null;
  /** The mark on the page this wing glides after (client px), null = rest. */
  at: { x: number; y: number } | null;
  weight: number;
}

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

function Mascot({ act, acting, theme, pointer, touch, pin, onReady, onFail, stats }: MascotCanvasProps) {
  const { penguin, clips } = useSoloPenguin();
  const palette = paletteFor(theme);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const holder = useHolder(penguin);
  useOwnBodyMaterial(penguin, palette.penguinBody);

  // frame the penguin by its height: its rest bounds, the camera a little above eye level
  const front = useRef(0.2);
  useLayoutEffect(() => {
    penguin.position.set(0, 0, 0);
    penguin.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(penguin);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    penguin.position.set(-c.x, -box.min.y, -c.z);
    // the content's depth: just in front of the belly (and the beak)
    front.current = s.z / 2 + 0.006;
    const h = s.y * FRAME_HEIGHT;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = h / 2 / Math.tan(fov / 2);
    const at = new THREE.Vector3(0, s.y * FRAME_CENTRE, 0);
    camera.position.set(0, at.y + dist * 0.1, dist);
    camera.lookAt(at);
    camera.updateProjectionMatrix();
  }, [penguin, camera, size.width, size.height]);

  const mixer = useMemo(() => new THREE.AnimationMixer(penguin), [penguin]);
  const actions = useMemo(() => new Map(clips.map((c) => [c.name as ClipName, mixer.clipAction(c)])), [clips, mixer]);
  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(penguin);
    },
    [mixer, penguin],
  );
  const current = useRef<THREE.AnimationAction | null>(null);
  useLayoutEffect(() => {
    const next = actions.get(ACT_CLIP[act]) ?? actions.get('idle') ?? null;
    if (!next || next === current.current) return;
    const prev = current.current;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, CROSSFADE, false);
    current.current = next;
  }, [act, actions]);

  const rig = useMemo(
    () => ({
      head: new Offset(findNode(penguin, 'head')),
      body: findNode(penguin, 'body'),
      hand: findNode(penguin, 'socket.hand.R'),
      wings: { L: { bone: findNode(penguin, 'wing.L'), at: null, weight: 0 }, R: { bone: findNode(penguin, 'wing.R'), at: null, weight: 0 } } as Record<Side, Wing>,
    }),
    [penguin],
  );

  // the props and the erasers live in the scene; the stamp hangs from the right wing's tip
  const stamp = useMemo(() => makeStamp(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rod = useMemo(() => makeRod(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const erasers = useMemo(() => [makeEraser(), makeEraser()], []);
  useEffect(() => {
    stamp.recolor(palette);
    rod.recolor(palette);
  }, [palette, stamp, rod]);
  useLayoutEffect(() => {
    const socket = rig.hand;
    stamp.group.scale.setScalar(0.0001);
    rod.group.scale.setScalar(0.0001);
    socket?.add(stamp.group);
    scene.add(rod.group, ...erasers);
    return () => {
      stamp.group.removeFromParent();
      rod.group.removeFromParent();
      for (const e of erasers) e.removeFromParent();
    };
  }, [rig, scene, stamp, rod, erasers]);
  useEffect(
    () => () => {
      stamp.dispose();
      rod.dispose();
      for (const e of erasers) {
        e.geometry.dispose();
        e.material.dispose();
      }
    },
    [stamp, rod, erasers],
  );

  const look = useRef<Look>({ body: 0, yaw: 0, pitch: 0 });
  const tmp = useMemo(
    () => ({
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      ray: new THREE.Ray(),
      shoulder: new THREE.Vector3(),
      tip: new THREE.Vector3(),
      goal: new THREE.Vector3(),
      hang: new THREE.Vector3(),
      v: new THREE.Vector3(),
      w: new THREE.Vector3(),
      tipLocal: new THREE.Vector3(),
    }),
    [],
  );
  const handLength = useMemo(() => rig.hand?.position.length() ?? 0.265, [rig]);
  const clipPose = useRef({
    L: (rig.wings.L.bone?.quaternion ?? new THREE.Quaternion()).clone(),
    R: (rig.wings.R.bone?.quaternion ?? new THREE.Quaternion()).clone(),
    scale: (rig.body?.scale ?? new THREE.Vector3(1, 1, 1)).clone(),
  });
  const props = useRef({ stamp: 0, rod: 0, acting: 0 });
  const fps = useRef({ n: 0, at: 0 });
  const drawn = useRef<'waiting' | 'drawn' | 'empty'>('waiting');
  const running = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = now();

    // the 2D poster gives way only once the penguin is really on screen
    if (drawn.current === 'waiting') {
      running.current += dt;
      drawn.current = drawState(state.gl.info.render.calls, running.current);
      if (drawn.current === 'drawn') onReady();
      else if (drawn.current === 'empty') onFail();
    }

    // the mixer only writes a bone when the clip's value changes (a still track is written once),
    // so put back what the clip wrote before turning the wings and squashing the body last frame
    rig.head.undo();
    for (const side of ['L', 'R'] as const) rig.wings[side].bone?.quaternion.copy(clipPose.current[side]);
    rig.body?.scale.copy(clipPose.current.scale);
    mixer.update(dt);
    for (const side of ['L', 'R'] as const) {
      const bone = rig.wings[side].bone;
      if (bone) clipPose.current[side].copy(bone.quaternion);
    }
    if (rig.body) clipPose.current.scale.copy(rig.body.scale);

    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const p = props.current;
    p.acting += ((acting ? 1 : 0) - p.acting) * k(6);

    // the stamp's hit squashes the body for a moment
    const stampMs = t - cues.stampAt;
    if (rig.body && act === 'control') {
      const sy = squashAt(stampMs);
      if (sy !== 1) rig.body.scale.multiply(tmp.v.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy)));
    }

    // gaze: the cursor (or a slow look around on touch); while acting, the head also looks down at the content
    const ptr = touch ? wander(t / 1000) : (pointer.current ?? { x: 0, y: 0 });
    const want = lookAt(ptr);
    want.body *= 1 - p.acting * (1 - ACT_BODY);
    want.pitch += ACT_PITCH * p.acting;
    look.current = follow(look.current, want, dt);
    const l = look.current;
    holder.rotation.y = l.body;
    rig.head.apply(tmp.q.setFromEuler(tmp.e.set(l.pitch, l.yaw, 0, 'YXZ')));
    holder.updateMatrixWorld(true);

    const rect = gl.domElement.getBoundingClientRect();
    const H = rect.height || 1;
    const stage = pin.current;
    const slide = acting && stage ? stage.querySelector<HTMLElement>('.landing-slide.is-on') : null;
    const mark = (sel: string) => slide?.querySelector(sel) ?? null;

    // where each wing goes this frame (page px, before the undamped offsets)
    const marks: Record<Side, { x: number; y: number } | null> = { L: null, R: null };
    for (const side of ['L', 'R'] as const) {
      const el = mark(`[data-hand="${side}"]`);
      if (el) marks[side] = centre(el);
    }
    const stampTarget = act === 'control' ? mark('[data-stamp-target]') : null;
    if (stampTarget) marks.R = centre(stampTarget);
    const rodMark = act === 'team' ? mark('[data-rod]') : null;

    // team: the rod at the paper's top edge, at a depth both wings reach; the wings hold it
    let rodAt: THREE.Vector3 | null = null;
    if (rodMark && rig.wings.L.bone && rig.wings.R.bone) {
      const c = centre(rodMark);
      const sheet = mark('.landing-scroll');
      const w = sheet ? sheet.getBoundingClientRect().width : rect.width * 0.8;
      rayAt(c.x, c.y, rect, camera, tmp.ray);
      const grip = 0.115;
      rig.wings.L.bone.getWorldPosition(tmp.shoulder);
      let z = front.current + 0.03;
      for (let i = 0; i < 2; i++) {
        atDepth(tmp.ray, z, tmp.goal);
        const dx = Math.max(0, Math.abs(tmp.shoulder.x) - grip);
        const dy = tmp.goal.y - tmp.shoulder.y;
        const room = handLength * handLength - dx * dx - dy * dy;
        z = Math.max(front.current + 0.025, tmp.shoulder.z + Math.sqrt(Math.max(0, room)));
      }
      rodAt = atDepth(tmp.ray, z, new THREE.Vector3());
      // the unroll: the rod dips as the paper lets go, then settles
      const um = t - cues.unrollAt;
      if (um > 0 && um < 520) rodAt.y -= Math.sin((um / 520) * Math.PI) * 0.018;
      // the paper's width at the rod's depth
      atDepth(rayAt(c.x - w / 2, c.y, rect, camera, tmp.ray), z, tmp.v);
      atDepth(rayAt(c.x + w / 2, c.y, rect, camera, tmp.ray), z, tmp.w);
      rod.setLength(tmp.v.distanceTo(tmp.w));
      rod.group.position.copy(rodAt);
    }

    for (const side of ['L', 'R'] as const) {
      const wing = rig.wings[side];
      const bone = wing.bone;
      if (!bone) continue;
      const target = rodAt ? { x: 0, y: 0 } : marks[side];
      wing.weight += ((target ? p.acting : 0) - wing.weight) * k(7);
      if (target && !rodAt) wing.at = wing.at ? { x: wing.at.x + (target.x - wing.at.x) * k(GLIDE), y: wing.at.y + (target.y - wing.at.y) * k(GLIDE) } : { ...target };
      if (wing.weight < 0.002) continue;

      bone.getWorldPosition(tmp.shoulder);
      tmp.tipLocal.set(0, handLength, 0);
      bone.localToWorld(tmp.tip.copy(tmp.tipLocal));
      const r = tmp.tip.distanceTo(tmp.shoulder);

      if (rodAt) {
        tmp.goal.copy(rodAt).add(tmp.v.set(side === 'L' ? 0.115 : -0.115, 0, 0));
      } else if (wing.at) {
        let { x, y } = wing.at;
        if (act === 'hero') {
          const pulse = tapPulse(t - cues.tapAt);
          y -= HOVER * H;
          y += (cues.tapSide === side ? HOVER + TAP_DOWN : -HOVER * 0.6) * H * pulse;
        } else if (act === 'what') {
          let lift = 0;
          for (let i = 0; i < 3; i++) if ((i % 2 ? 'L' : 'R') === side) lift += flipLift(t - cues.flipAt - i * FLIP_STEP_MS);
          y -= FLIP_UP * H * lift;
        }
        if (side === 'R' && stampTarget) x -= STAMP_ASIDE * H * stampAside(stampMs);
        rayAt(x, y, rect, camera, tmp.ray);
        if (side === 'R' && stampTarget) {
          tmp.hang.set(0, STAMP_LENGTH + stampLift(stampMs), 0);
          reach(tmp.ray, tmp.shoulder, r, tmp.goal, tmp.hang);
        } else reach(tmp.ray, tmp.shoulder, r, tmp.goal);
      } else continue;
      aim(bone, tmp.shoulder, tmp.tip, tmp.goal, wing.weight);
    }

    // props: grow in for their act, shrink away after
    p.stamp += ((act === 'control' && acting ? 1 : 0) - p.stamp) * k(8);
    p.rod += ((rodAt ? 1 : 0) - p.rod) * k(8);
    stamp.group.scale.setScalar(Math.max(0.0001, p.stamp));
    rod.group.scale.setScalar(Math.max(0.0001, p.rod));
    if (rig.hand && p.stamp > 0.001) {
      // upright in the world whatever the wing does, leaning back as it rises
      rig.hand.getWorldQuaternion(tmp.q).invert();
      stamp.group.quaternion.copy(tmp.q).multiply(new THREE.Quaternion().setFromEuler(tmp.e.set(stampMs > 0 && stampMs < STAMP_TOTAL_MS ? stampTilt(stampMs) : 0, 0, 0)));
    }

    // cut the body out behind the content of each slide that is showing (two while they cross-fade)
    let used = 0;
    if (stage && acting) {
      for (const el of stage.querySelectorAll<HTMLElement>('.landing-slide')) {
        if (used >= erasers.length) break;
        const opacity = parseFloat(getComputedStyle(el).opacity || '0');
        if (opacity < 0.01) continue;
        let box: { left: number; top: number; right: number; bottom: number } | null = null;
        for (const f of el.querySelectorAll('[data-front]')) {
          const r = f.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        if (!box) continue;
        const eraser = erasers[used++];
        fitEraser(eraser, box, front.current, rect, camera, tmp.ray);
        eraser.material.opacity = opacity * p.acting;
        eraser.visible = true;
      }
    }
    for (let i = used; i < erasers.length; i++) erasers[i].visible = false;

    if (stats) {
      stats.calls = state.gl.info.render.calls;
      const now2 = state.clock.elapsedTime;
      fps.current.n++;
      if (now2 - fps.current.at >= 1) {
        stats.fps = Math.round(fps.current.n / (now2 - fps.current.at));
        fps.current = { n: 0, at: now2 };
        const project = (v: THREE.Vector3) => (1 - v.project(camera).y) / 2;
        const sh = rig.wings.R.bone?.getWorldPosition(new THREE.Vector3());
        const box = new THREE.Box3().setFromObject(penguin);
        stats.frame = {
          shoulder: sh ? +project(sh).toFixed(3) : 0,
          tip: rig.hand ? +project(rig.hand.getWorldPosition(new THREE.Vector3())).toFixed(3) : 0,
          feet: +project(new THREE.Vector3(0, box.min.y, 0)).toFixed(3),
          head: +project(new THREE.Vector3(0, box.max.y, 0)).toFixed(3),
        };
      }
    }
  });

  const sky = palette.sky;
  const lights = palette.agentLights;
  return (
    <>
      <SkyLight color={sky.ambient} intensity={sky.ambientIntensity} />
      {lights ? (
        <>
          {/* evening overtime: a warm desk lamp from the left, the laptop's cool light on the face, the moon rim behind */}
          <pointLight position={[-0.7, 0.9, 0.5]} color={lights.lamp.color} intensity={lights.lamp.intensity * 0.9} distance={3} decay={2} />
          <pointLight position={[0.15, 0.4, 0.9]} color={lights.screen.color} intensity={lights.screen.intensity * 1.2} distance={2.2} decay={2} />
          <directionalLight position={[sky.from[0] * 4, sky.from[1] * 4, sky.from[2] * 4]} color={sky.sun} intensity={sky.sunIntensity * Math.PI} />
        </>
      ) : (
        <directionalLight position={[sky.from[0] * 4, sky.from[1] * 4, sky.from[2] * 4 + 2]} color={sky.sun} intensity={sky.sunIntensity * Math.PI} />
      )}
      <primitive object={holder} name={`${nameOf(penguin)}@landing`} />
    </>
  );
}
