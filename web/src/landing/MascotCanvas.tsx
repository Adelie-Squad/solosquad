// The landing's 3D mascot — the lazily loaded part (three.js · R3F · drei · penguin.glb). One
// plain penguin from the office loader (office/penguinAsset.ts), coloured by the office palette
// (light = day, dark = evening overtime). The canvas covers the scene column; each section's content
// is centred there and the penguin walks to a spot picked from that content's box (staging.ts) and
// acts on it (DESIGN.md `## 랜딩` — 자리 · 연기): it patters above the prompt box, hands the request
// to the step cards, peeks over the scroll and holds its rod, stamps the approval from the card's
// corner, waves from behind the last card. The head follows the cursor, toned down while acting.
//
// It enters once per page load as a clay ball that drops in, squashes, stretches and settles into
// the penguin (intro.ts · morph.ts); nothing of it shows before that — no 2D poster.
//
// The camera is orthographic and one world unit is `zoom` CSS pixels, so a point of the page and
// a point of the scene map onto each other exactly at any size, and the penguin keeps its own units
// (the wing reach, the stamp, the lights).
//
// What shows in front of the content (DESIGN.md `## 랜딩` — 가림): three passes. (1) the whole
// penguin; (2) an eraser over each content box wipes every pixel there — depth plays no part, so no
// turn, lean or nod can push a body part through; (3) the acting wing — the one away from the
// content (arms.ts); the body turns towards the content so it swings round in front of the body,
// stretching a little like clay when it must reach across — and the props it holds are drawn again
// on top, but only once the wing has come round the content's edge: it starts behind, goes out past
// the edge, and only when the whole wing is clear of the content does it switch to the front pass,
// then moves in to point, stamp or type. The near wing stays tucked and is never drawn over it.
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
import { ACT_CLIP, cues, now, relayHand, squashAt, STAMP_TOTAL_MS, stampAside, stampLift, stampTilt, tugAt, WAVE_SWING, waveAt, WING_GLIDE } from './acting';
import { actingWings, actYaw, ARM_MS, bodyTurn, EDGE_MARGIN, nextFront, outside, pathAt, rectsOverlap, segmentHits, stretchFor, viaPoint, type Pt, type Rect } from './arms';
import { drawState, follow, GAZE_ACTING, lookAt, wander, type Look, type Pointer } from './gaze';
import { useHolder } from './holder';
import { claimIntro, introAt, REST, type IntroPose } from './intro';
import { makeMorph, type Morph } from './morph';
import { makeRod, makeStamp, STAMP_LENGTH } from './props';
import { aim, atDepth, fitEraser, makeEraser, ORDER, rayAt, reach, useFrontPass, type Side } from './rig';
import type { SectionId } from './sections';
import { headOf, moveAt, MOVE_MS, penguinHeight, spotFor, STROKE_DEPTH, STROKE_LIFT, strokeAt, type Box, type Spot } from './staging';

preloadPenguin();

export type { Pointer };

export interface LandingStats {
  fps: number;
  /** Last frame's draw calls — 0 means nothing is on screen. */
  calls: number;
  /** The penguin this frame (client px) — where it stands, its height, and whether it has arrived. */
  spot?: Spot & { settled: boolean };
  /** The body bone, the wing tips and the shoulders this frame (client px) — the frame sequences read them. */
  body?: { x: number; y: number };
  tips?: Record<Side, { x: number; y: number }>;
  shoulders?: Record<Side, { x: number; y: number }>;
  /** Which wings are drawn over the content this frame, and how far along its path each wing is. */
  front?: Record<Side, boolean>;
  path?: Record<Side, number>;
  /** The wings acting in this section (arms.ts — the one on the content's side). */
  acting?: Side[];
  /** The content rectangle that hides the body (client px). */
  rect?: Rect;
  /** How much the wings are typing (0 … 1, eased). */
  typing?: number;
  /** The entrance this frame (intro.ts), ms since it began. */
  intro?: IntroPose & { ms: number };
}

export interface MascotCanvasProps {
  /** The section on stage — which act. */
  act: SectionId;
  /** Acting on the content (otherwise the clip alone, the wings at rest). */
  acting: boolean;
  theme: Theme;
  mobile: boolean;
  paused: boolean;
  /** The cursor, client px (null = none). */
  pointer: RefObject<Pointer | null>;
  /** No cursor (touch): a slow look around instead of following. */
  touch: boolean;
  /** The pinned stage holding the slides and their marks. */
  pin: RefObject<HTMLElement | null>;
  /** The penguin is on screen and has finished its entrance — the acting may start. */
  onReady: () => void;
  onFail: () => void;
  stats?: LandingStats;
}

/** The head looks down at the content a little while acting (rad). */
const ACT_PITCH = 0.1;
/** Where the wings rest on a top edge, either side of the penguin's middle (fraction of its height). */
const REACH = 0.19;
/** A fading card hides the body this many times faster than it shows itself (fully hidden at 40 %). */
const ERASE_GAIN = 2.5;
/** How far aside of the button the stamp is held at rest (fraction of the penguin's height). */
const STAMP_ASIDE = 0.42;
/** Where the wing holds the stamp: this share of its length above the face (its waist, not the knob — the far wing reaches across the body). */
const STAMP_GRIP = 0.4;

export default function MascotCanvas(props: MascotCanvasProps) {
  const { onFail } = props;
  return (
    <Canvas
      className="landing-canvas"
      // above the content but never in the way of a click (R3F sets pointer-events inline otherwise)
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
      flat
      orthographic
      dpr={props.mobile ? 1.5 : Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)}
      frameloop={props.paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 10], zoom: 300, near: 0.01, far: 40 }}
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
      if (!mesh.isMesh || mesh.userData.landingFront) return;
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

interface Wing {
  bone: THREE.Object3D | null;
  /** The target on the page this wing glides after (client px), null = none yet. */
  at: Pt | null;
  /** How far along its path rest → round the edge → target (0 … 1). */
  u: number;
  /** In front of the content this frame (arms.ts `nextFront`). */
  front: boolean;
  /** The last target and content rectangle — the way back goes round the same edge. */
  to: Pt | null;
  rect: Rect | null;
  /** The section of the target it is gliding after. */
  act: SectionId | null;
  /** How far the clay wing is stretched along its length (1 = not at all — arms.ts `stretchFor`). */
  stretch: number;
  /** The bone's own scale (put back every frame before the stretch). */
  scale: THREE.Vector3;
}

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const boxOf = (el: Element | null | undefined): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
};

/** What hides the body on a slide: the union of its `data-front` boxes (`ground` = and all below). */
function occluderOf(slide: Element, bottom: number): Rect | null {
  let box: Rect | null = null;
  let ground = false;
  for (const f of slide.querySelectorAll<HTMLElement>('[data-front]')) {
    const r = f.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (f.dataset.front === 'ground') ground = true;
    box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  // `ground`: the penguin stands behind this card — nothing of it shows under the card either
  if (box && ground) box.bottom = Math.max(box.bottom, bottom);
  return box;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SIDES = ['L', 'R'] as const;

function Mascot({ act, acting, theme, mobile, pointer, touch, pin, onReady, onFail, stats }: MascotCanvasProps) {
  const { penguin, clips } = useSoloPenguin();
  const palette = paletteFor(theme);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const holder = useHolder(penguin);
  useOwnBodyMaterial(penguin, palette.penguinBody);
  const front = useFrontPass(penguin, palette.penguinBody);
  const lights = useRef<THREE.Group>(null);

  // the penguin stands on the holder's origin; its height sets the camera's zoom
  const dims = useRef({ height: 0.78 });
  const morph = useRef<Morph | null>(null);
  useLayoutEffect(() => {
    penguin.position.set(0, 0, 0);
    holder.position.set(0, 0, 0);
    holder.rotation.set(0, 0, 0);
    holder.scale.set(1, 1, 1);
    // measured at rest in the holder's own frame — never mid-entrance, when the holder is tiny
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(penguin);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    penguin.position.set(-c.x, -box.min.y, -c.z);
    dims.current = { height: s.y };
    holder.rotation.order = 'ZYX';
    holder.updateMatrixWorld(true);
    // the entrance's ball: from the body's own bounds (morph.ts), set up at rest
    morph.current = makeMorph(penguin, holder);
    return () => {
      morph.current?.dispose();
      morph.current = null;
    };
  }, [penguin, holder]);

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
      head: findNode(penguin, 'head'),
      body: findNode(penguin, 'body'),
      wings: {
        L: { bone: findNode(penguin, 'wing.L'), at: null, u: 0, front: false, to: null, rect: null, act: null, stretch: 1, scale: (findNode(penguin, 'wing.L')?.scale ?? new THREE.Vector3(1, 1, 1)).clone() },
        R: { bone: findNode(penguin, 'wing.R'), at: null, u: 0, front: false, to: null, rect: null, act: null, stretch: 1, scale: (findNode(penguin, 'wing.R')?.scale ?? new THREE.Vector3(1, 1, 1)).clone() },
      } as Record<Side, Wing>,
    }),
    [penguin],
  );
  const handLength = useMemo(() => findNode(penguin, 'socket.hand.R')?.position.length() ?? 0.265, [penguin]);

  // the props live in the scene; the stamp is held at the acting wing's tip (placed every frame)
  const stamp = useMemo(() => makeStamp(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rod = useMemo(() => makeRod(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const erasers = useMemo(() => [makeEraser(), makeEraser()], []);
  useEffect(() => {
    stamp.recolor(palette);
    rod.recolor(palette);
  }, [palette, stamp, rod]);
  useLayoutEffect(() => {
    stamp.group.scale.setScalar(0.0001);
    rod.group.scale.setScalar(0.0001);
    scene.add(stamp.group, rod.group, ...erasers);
    return () => {
      stamp.group.removeFromParent();
      rod.group.removeFromParent();
      for (const e of erasers) e.removeFromParent();
    };
  }, [scene, stamp, rod, erasers]);
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
      ball: new THREE.Vector3(),
      tipLocal: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );
  // what the clip wrote this frame — put back before the next mix (the mixer only writes a bone
  // when its value changes, so last frame's turns would otherwise pile up)
  const clipPose = useRef({
    head: (rig.head?.quaternion ?? new THREE.Quaternion()).clone(),
    L: (rig.wings.L.bone?.quaternion ?? new THREE.Quaternion()).clone(),
    R: (rig.wings.R.bone?.quaternion ?? new THREE.Quaternion()).clone(),
    scale: (rig.body?.scale ?? new THREE.Vector3(1, 1, 1)).clone(),
  });
  const p = useRef({ stamp: 0, rod: 0, acting: 0, typing: 0, yaw: 0 });
  const move = useRef<{ act: SectionId | null; from: Spot | null; at: number; cur: Spot | null }>({ act: null, from: null, at: 0, cur: null });
  const fps = useRef({ n: 0, at: 0 });
  const drawn = useRef<'waiting' | 'drawn' | 'empty'>('waiting');
  const running = useRef(0);
  /** When the entrance began (null = not yet decided, -Infinity = skipped) and whether the acting may start. */
  const intro = useRef<{ at: number | null; told: boolean }>({ at: null, told: false });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = now();
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // the safety net: nothing drawn within GIVE_UP_SECONDS → the stacked page (an empty stage meanwhile)
    if (drawn.current === 'waiting') {
      running.current += dt;
      drawn.current = drawState(state.gl.info.render.calls, running.current);
      if (drawn.current === 'empty') onFail();
    }
    // the entrance: once per page load, from the first frame (never under reduced motion)
    const ii = intro.current;
    if (ii.at === null) ii.at = claimIntro(reducedMotion()) ? t : -Infinity;
    // `?landing-debug`: `window.__landingIntroAt = ms` holds the entrance at that moment (frame sequences)
    const held = stats ? (window as unknown as { __landingIntroAt?: number }).__landingIntroAt : undefined;
    const pose = typeof held === 'number' ? introAt(held) : ii.at === -Infinity ? REST : introAt(t - ii.at);
    if (pose.done && drawn.current === 'drawn' && !ii.told) {
      ii.told = true;
      onReady();
    }

    const cp = clipPose.current;
    rig.head?.quaternion.copy(cp.head);
    for (const side of SIDES) {
      rig.wings[side].bone?.quaternion.copy(cp[side]);
      rig.wings[side].bone?.scale.copy(rig.wings[side].scale);
    }
    rig.body?.scale.copy(cp.scale);
    mixer.update(dt);
    if (rig.head) cp.head.copy(rig.head.quaternion);
    for (const side of SIDES) {
      const bone = rig.wings[side].bone;
      if (bone) cp[side].copy(bone.quaternion);
    }
    if (rig.body) cp.scale.copy(rig.body.scale);

    const pp = p.current;
    pp.acting += ((acting ? 1 : 0) - pp.acting) * k(4);
    pp.typing += ((acting && act === 'hero' && cues.typing ? 1 : 0) - pp.typing) * k(5);

    // ── where the penguin stands: the spot for this section's content, walked to over MOVE_MS ──
    const rect = gl.domElement.getBoundingClientRect();
    const stage = pin.current;
    const slide = stage?.querySelector<HTMLElement>(`[data-slide="${act}"]`) ?? null;
    const content = boxOf(slide?.querySelector('[data-content]'));
    const sceneBox = boxOf(slide?.querySelector('.landing-scene'));
    const m = move.current;
    let target = m.cur;
    if (content && sceneBox) target = spotFor(act, content, penguinHeight(sceneBox, mobile), mobile);
    if (!target) return;
    if (m.act !== act) {
      m.from = m.cur ?? target;
      m.at = m.cur ? t : -Infinity;
      m.act = act;
    }
    const cur = moveAt(m.from ?? target, target, t - m.at);
    m.cur = cur;
    const settled = t - m.at >= MOVE_MS;
    const live = acting && settled;

    const H = cur.h;
    const zoom = H / dims.current.height;
    if (Math.abs(camera.zoom - zoom) > 1e-4) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    const toWorld = (x: number, y: number, z: number, out: THREE.Vector3) => atDepth(rayAt(x, y, rect, camera, tmp.ray), z, out);
    const toPage = (v: THREE.Vector3): Pt => {
      const n = tmp.w.copy(v).project(camera);
      return { x: rect.left + ((n.x + 1) / 2) * rect.width, y: rect.top + ((1 - n.y) / 2) * rect.height };
    };
    toWorld(cur.x, cur.y, 0, holder.position);
    lights.current?.position.copy(holder.position);

    // ── the entrance: a ball on the floor (the content's top edge when the feet are behind it) ──
    const mo = morph.current;
    if (mo) {
      if (!pose.done) {
        const h = dims.current.height;
        // the ball rests on the top edge of the content the penguin stands behind, else on its feet
        const behind = content && cur.x > content.left && cur.x < content.left + content.width && cur.y > content.top;
        const floor = behind ? Math.min(0.6 * h, Math.max(0, (cur.y - content.top) / zoom)) : 0;
        tmp.ball.copy(mo.core);
        tmp.ball.y = Math.max(mo.core.y, floor + mo.radius);
        mo.set(tmp.ball, pose.morph, pose.parts);
        // squash and stretch about the contact point (the ball's bottom, the feet once it is the penguin)
        const contact = (tmp.ball.y - mo.radius) * (1 - pose.morph);
        const sy = pose.sy * pose.size;
        const sx = pose.size / Math.sqrt(Math.max(0.01, pose.sy));
        holder.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sx));
        holder.position.y += contact * (1 - sy) + pose.lift * h;
      } else if (holder.scale.x !== 1 || holder.scale.y !== 1) {
        mo.set(mo.core, 1, 1);
        holder.scale.set(1, 1, 1);
      }
    }

    // the stamp's hit squashes the body a little
    const stampMs = t - cues.stampAt;
    if (rig.body && act === 'control') {
      const sy = squashAt(stampMs);
      if (sy !== 1) rig.body.scale.multiply(tmp.v.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy)));
    }

    // gaze: measured from the head; a lit card wins while acting; toned down while acting; still
    // during the entrance (a turning head would pull the ball out of shape)
    const head = headOf(cur);
    const gazeEl = live ? slide?.querySelector('[data-gaze]') : null;
    const px = gazeEl ? centre(gazeEl) : pointer.current;
    const ptr = touch && !gazeEl ? wander(t / 1000) : px ? { x: (px.x - head.x) / (rect.width * 0.5 || 1), y: (px.y - head.y) / (rect.height * 0.5 || 1) } : { x: 0, y: 0 };
    const want = lookAt(ptr);
    const calm = (1 - pp.acting * (1 - GAZE_ACTING)) * (pose.done ? 1 : 0);
    want.body *= calm;
    want.yaw *= calm;
    want.pitch = want.pitch * calm + ACT_PITCH * pp.acting;
    look.current = follow(look.current, want, dt);
    const l = look.current;
    // the body turns towards the content while acting, so the far wing comes round in front of it
    const contentCx = content ? content.left + content.width / 2 : cur.x;
    pp.yaw += ((live ? actYaw(act, cur.x, contentCx) : 0) - pp.yaw) * k(3);
    holder.rotation.set(0, bodyTurn(cur.turn + pp.yaw, l.body), cur.lean);
    rig.head?.quaternion.multiply(tmp.q.setFromEuler(tmp.e.set(l.pitch, l.yaw, 0, 'YXZ')));
    holder.updateMatrixWorld(true);

    // ── the wings: which act (the one on the content's side), each one's target on the page ──
    const mark = (sel: string) => slide?.querySelector(sel) ?? null;
    const occluder = slide ? occluderOf(slide, rect.bottom) : null;
    const marks: Record<Side, Pt | null> = { L: null, R: null };
    let actTarget: Pt | null = null;
    const stampMark = act === 'control' ? mark('[data-stamp-target]') : null;
    const handMark = act === 'what' ? mark('[data-hand]') : null;
    // team: the rod along the paper's top edge; the wing takes the knob on the penguin's side
    const rodMark = act === 'team' ? mark('[data-rod]') : null;
    const sheet = mark('.landing-scroll');
    let knob: Pt | null = null;
    let rodWidth = 0;
    if (rodMark && sheet) {
      const c = centre(rodMark);
      rodWidth = sheet.getBoundingClientRect().width / zoom;
      const dir = cur.x < c.x ? -1 : 1;
      knob = { x: c.x + dir * (rodWidth / 2 + 0.022) * zoom, y: c.y };
    }
    if (act === 'what' && handMark) actTarget = centre(handMark);
    else if (act === 'control' && stampMark) {
      // the stamp lands on the button's end nearest the penguin (it comes from beside the card)
      const r = stampMark.getBoundingClientRect();
      const near = cur.x < r.left + r.width / 2;
      const inset = Math.min(r.width / 2, 0.11 * H);
      actTarget = { x: near ? r.left + inset : r.right - inset, y: r.top + r.height / 2 };
    }
    else if (act === 'team') actTarget = knob;
    const { wings: actingSet, wave } = actingWings(act, cur.x, contentCx);
    const stampSide: Side = actingSet[0] ?? 'R';
    if (live && content) {
      const edge = content.top + 0.015 * H;
      if (act === 'hero' || act === 'start') {
        marks.L = { x: cur.x + REACH * H, y: edge };
        marks.R = { x: cur.x - REACH * H, y: edge };
      } else if (actTarget) marks[actingSet[0]] = actTarget;
    }

    // the rod sits at the depth where the wing on the knob reaches it
    const rodBone = act === 'team' && actingSet[0] ? rig.wings[actingSet[0]].bone : null;
    const rodOn = live && !!knob && !!rodMark && !!rodBone;
    if (rodOn && knob && rodMark && rodBone) {
      const c = centre(rodMark);
      rodBone.getWorldPosition(tmp.shoulder);
      const r = handLength * (rodBone.getWorldScale(tmp.w).y || 1);
      reach(rayAt(knob.x, knob.y, rect, camera, tmp.ray), tmp.shoulder, r, tmp.goal);
      toWorld(c.x, c.y, tmp.goal.z, rod.group.position);
      rod.group.position.y += tugAt(t - cues.unrollAt) * dims.current.height;
      rod.setLength(rodWidth);
    }

    const frontNow: Record<Side, boolean> = { L: false, R: false };
    const stampAt = tmp.ball.set(0, -100, 0);
    const pathNow: Record<Side, number> = { L: 0, R: 0 };
    const shoulders = {} as Record<Side, Pt>;
    const tips = {} as Record<Side, Pt>;
    for (const side of SIDES) {
      const wing = rig.wings[side];
      const bone = wing.bone;
      if (!bone) continue;
      const goalMark = actingSet.includes(side) ? marks[side] : null;
      if (goalMark) {
        // a new section starts from its own mark (never glides over from the last one)
        wing.at = wing.at && wing.u > 0 && wing.act === act ? { x: wing.at.x + (goalMark.x - wing.at.x) * k(WING_GLIDE), y: wing.at.y + (goalMark.y - wing.at.y) * k(WING_GLIDE) } : { ...goalMark };
        wing.rect = occluder;
        wing.act = act;
      }

      // along the path: out and in over ARM_MS; the relay's hand follows its own curve (out · beat · back)
      const before = wing.u;
      if (act === 'what' && actingSet.includes(side) && live) wing.u = relayHand(t - cues.relayAt);
      else wing.u = Math.max(0, Math.min(1, wing.u + ((goalMark ? 1 : -1) * dt * 1000) / ARM_MS));
      const du = wing.u - before;

      bone.getWorldPosition(tmp.shoulder);
      bone.localToWorld(tmp.tip.copy(tmp.tipLocal).multiplyScalar(handLength));
      const shoulderPt = toPage(tmp.shoulder);
      shoulders[side] = shoulderPt;

      if (wing.u > 0 && wing.at) {
        let { x, y } = wing.at;
        if (act === 'hero') {
          // pretend typing: small alternating strokes above the keys, eased in and out with the box
          y += pp.typing * (-STROKE_LIFT * H + (STROKE_LIFT + STROKE_DEPTH) * H * strokeAt(t / 1000, side));
        } else if (act === 'start' && side === wave) {
          const w = waveAt(t - cues.waveAt);
          const out = side === 'L' ? 1 : -1;
          x += out * (w.raise * 0.17 * H + w.swing * WAVE_SWING * H);
          y -= w.raise * 0.42 * H;
        } else if (act === 'control' && side === stampSide && wing.rect) {
          // held aside — beside the card's corner, outside it — until the stamp comes over the button
          const dir = cur.x < x ? -1 : 1;
          const clearX = dir < 0 ? wing.rect.left - EDGE_MARGIN * H - 0.06 * zoom : wing.rect.right + EDGE_MARGIN * H + 0.06 * zoom;
          const restX = dir < 0 ? Math.min(x - STAMP_ASIDE * H, clearX) : Math.max(x + STAMP_ASIDE * H, clearX);
          x += (restX - x) * stampAside(stampMs);
        }
        wing.to = { x, y };
      }
      const r = tmp.tip.distanceTo(tmp.shoulder);
      const rest = toPage(tmp.tip);
      let tipPt = rest;
      const holding = act === 'control' && side === stampSide;
      const hang = holding ? STAMP_GRIP * STAMP_LENGTH + stampLift(stampMs) : 0;
      let stretchTo = 1;
      if (wing.u > 0 && wing.to && wing.rect) {
        const via = viaPoint(wing.rect, shoulderPt, wing.to, EDGE_MARGIN * H);
        const at = pathAt({ from: rest, via, to: wing.to }, wing.u);
        // the far wing reaches across the body: a clay stretch when the point is past its length
        stretchTo = stretchFor(Math.hypot(at.x - shoulderPt.x, at.y - hang * zoom - shoulderPt.y), r * zoom);
      }
      wing.stretch += (stretchTo - wing.stretch) * k(8);
      if (wing.stretch > 1.001) {
        bone.scale.y = wing.scale.y * wing.stretch;
        bone.updateMatrixWorld(true);
        bone.localToWorld(tmp.tip.copy(tmp.tipLocal).multiplyScalar(handLength));
      }
      if (wing.u > 0 && wing.to && wing.rect) {
        const via = viaPoint(wing.rect, shoulderPt, wing.to, EDGE_MARGIN * H);
        const at = pathAt({ from: rest, via, to: wing.to }, wing.u);
        const reachR = r * wing.stretch;
        if (act === 'what') {
          // the far wing sweeps out at full length (round the belly, not foreshortened towards the
          // camera, where it would pass in front of the face)
          const dx = at.x - shoulderPt.x;
          const dy = at.y - shoulderPt.y;
          const len = Math.hypot(dx, dy);
          const min = 0.8 * reachR * zoom;
          if (len > 1e-3 && len < min) {
            at.x = shoulderPt.x + (dx / len) * min;
            at.y = shoulderPt.y + (dy / len) * min;
          }
        }
        rayAt(at.x, at.y, rect, camera, tmp.ray);
        if (holding) {
          tmp.hang.set(0, hang, 0);
          reach(tmp.ray, tmp.shoulder, reachR, tmp.goal, tmp.hang);
        } else reach(tmp.ray, tmp.shoulder, reachR, tmp.goal);
        // fully on the path once it has left the rest pose a little (the start is behind anyway)
        const weight = Math.min(1, wing.u / 0.12);
        aim(bone, tmp.shoulder, tmp.tip, tmp.goal, weight);
        tipPt = toPage(bone.localToWorld(tmp.tip.copy(tmp.tipLocal).multiplyScalar(handLength)));
      }
      tips[side] = tipPt;
      const box = wing.rect ?? occluder;
      let clear = !box || !segmentHits(shoulderPt, tipPt, box);
      if (box && act === 'control' && side === stampSide && pp.stamp > 0.05) {
        // the stamp hangs under the tip: it must be off the card too before the pass changes
        const half = 0.05 * zoom * pp.stamp;
        clear &&= !rectsOverlap({ left: tipPt.x - half, right: tipPt.x + half, top: tipPt.y - (1 - STAMP_GRIP) * STAMP_LENGTH * zoom * pp.stamp, bottom: tipPt.y + STAMP_GRIP * STAMP_LENGTH * zoom * pp.stamp }, box);
      }
      const shoulderOut = !box || outside(shoulderPt, box);
      wing.front = actingSet.includes(side) || wing.front ? nextFront(wing.front, wing.u, du, clear, shoulderOut) : false;
      if (holding) tmp.v.copy(tmp.tipLocal).multiplyScalar(handLength).applyMatrix4(bone.matrixWorld);
      if (holding) stampAt.copy(tmp.v);
      if (wing.u <= 0) {
        wing.to = null;
        wing.rect = null;
      }
      frontNow[side] = wing.front;
      pathNow[side] = Math.round(wing.u * 100) / 100;
    }
    front.set(frontNow);

    // props: grow in for their act, shrink away after; the stamp is drawn in front only with its wing
    pp.stamp += ((act === 'control' && live ? 1 : 0) - pp.stamp) * k(6);
    pp.rod += ((rodOn ? 1 : 0) - pp.rod) * k(6);
    stamp.group.scale.setScalar(Math.max(0.0001, pp.stamp));
    rod.group.scale.setScalar(Math.max(0.0001, pp.rod));
    const stampOrder = rig.wings[stampSide].front ? ORDER.front : 0;
    for (const c of stamp.group.children) c.renderOrder = stampOrder;
    if (pp.stamp > 0.001) {
      // held at its waist in the wing tip, upright in the world whatever the wing does, leaning back as it rises
      stamp.group.position.copy(stampAt).add(tmp.v.set(0, (1 - STAMP_GRIP) * STAMP_LENGTH * pp.stamp, 0));
      stamp.group.quaternion.setFromEuler(tmp.e.set(stampMs > 0 && stampMs < STAMP_TOTAL_MS ? stampTilt(stampMs) : 0, 0, 0));
    }

    // wipe the body out behind the content of each slide that is showing (two while they cross-fade)
    // — from the first frame, so the entrance is hidden behind the content like the penguin is
    let used = 0;
    if (stage) {
      for (const el of stage.querySelectorAll<HTMLElement>('.landing-slide')) {
        if (used >= erasers.length) break;
        const opacity = parseFloat(getComputedStyle(el).opacity || '0');
        if (opacity < 0.01) continue;
        const box = el === slide && occluder ? occluder : occluderOf(el, rect.bottom);
        if (!box) continue;
        const eraser = erasers[used++];
        fitEraser(eraser, box, 1, rect, camera, tmp.ray);
        // a card that is still fading in already hides the body (no penguin seen through it)
        eraser.material.opacity = Math.min(1, opacity * ERASE_GAIN);
        eraser.visible = true;
      }
    }
    for (let i = used; i < erasers.length; i++) erasers[i].visible = false;

    if (stats) {
      const round = (q: Pt) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 });
      stats.calls = state.gl.info.render.calls;
      stats.spot = { ...cur, settled };
      if (rig.body) stats.body = round(toPage(rig.body.getWorldPosition(new THREE.Vector3())));
      const tipsOut = {} as Record<Side, Pt>;
      const shouldersOut = {} as Record<Side, Pt>;
      for (const side of SIDES) {
        if (tips[side]) tipsOut[side] = round(tips[side]);
        if (shoulders[side]) shouldersOut[side] = round(shoulders[side]);
      }
      stats.tips = tipsOut;
      stats.shoulders = shouldersOut;
      stats.front = frontNow;
      stats.path = pathNow;
      stats.acting = actingSet;
      stats.rect = occluder ?? undefined;
      stats.typing = Math.round(pp.typing * 100) / 100;
      stats.intro = { ...pose, ms: ii.at === null || ii.at === -Infinity ? -1 : Math.round(t - ii.at) };
      const now2 = state.clock.elapsedTime;
      fps.current.n++;
      if (now2 - fps.current.at >= 1) {
        stats.fps = Math.round(fps.current.n / (now2 - fps.current.at));
        fps.current = { n: 0, at: now2 };
      }
    }
  });

  const sky = palette.sky;
  const agentLights = palette.agentLights;
  return (
    <>
      <SkyLight color={sky.ambient} intensity={sky.ambientIntensity} />
      {/* the lights walk with the penguin (positions in its own units) */}
      <group ref={lights}>
        {agentLights ? (
          <>
            {/* evening overtime: a warm desk lamp from the left, the laptop's cool light on the face, the moon rim behind */}
            <pointLight position={[-0.7, 0.9, 0.5]} color={agentLights.lamp.color} intensity={agentLights.lamp.intensity * 0.9} distance={3} decay={2} />
            <pointLight position={[0.15, 0.4, 0.9]} color={agentLights.screen.color} intensity={agentLights.screen.intensity * 1.2} distance={2.2} decay={2} />
          </>
        ) : null}
      </group>
      <directionalLight position={[sky.from[0] * 4, sky.from[1] * 4, sky.from[2] * 4 + (agentLights ? 0 : 2)]} color={sky.sun} intensity={sky.sunIntensity * Math.PI} />
      <primitive object={holder} name={`${nameOf(penguin)}@landing`} />
    </>
  );
}
