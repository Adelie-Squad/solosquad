// The landing's 3D mascot — the lazily loaded part (three.js · R3F · drei · penguin.glb). One
// plain penguin from the office loader (office/penguinAsset.ts), coloured by the office palette
// (light = day, dark = evening overtime). The canvas covers the scene column; each section's content
// is centred there and the penguin walks to a spot picked from that content's box (staging.ts) and
// acts on it (DESIGN.md `## 랜딩` — 자리 · 연기): it patters above the prompt box, hands the request
// to the step cards, peeks over the scroll and holds its rod, stamps the approval from the card's
// corner, waves from behind the last card. The head follows the cursor, toned down while acting.
//
// The camera is orthographic and one world unit is `zoom` CSS pixels, so a point of the page and
// a point of the scene map onto each other exactly at any size, and the penguin keeps its own units
// (the wing reach, the stamp, the lights).
//
// What shows in front of the content (DESIGN.md `## 랜딩` — 가림): three passes. (1) the whole
// penguin; (2) an eraser over each content box wipes every pixel there — depth plays no part, so no
// turn, lean or nod can push a body part through; (3) only the wings that are meant to touch the
// content (`FRONT` — the typing wings on the box edge, the wing on the rod, the stamp wing) and the
// props are drawn again on top. Anything else of the body under the content stays wiped.
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
import { ACT_CLIP, cues, now, relayHand, squashAt, STAMP_TOTAL_MS, stampAside, stampLift, stampTilt, tugAt, WAVE_SWING, waveAt, WING_GLIDE, WING_WEIGHT_RATE } from './acting';
import { drawState, follow, GAZE_ACTING, lookAt, wander, type Look, type Pointer } from './gaze';
import { useHolder } from './holder';
import { makeRod, makeStamp, STAMP_LENGTH } from './props';
import { aim, atDepth, fitEraser, FRONT, makeEraser, rayAt, reach, useFrontPass, type Side } from './rig';
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
  /** The body bone and the wing tips this frame (client px) — the frame sequences read them. */
  body?: { x: number; y: number };
  tips?: Record<Side, { x: number; y: number }>;
  /** Which wings are drawn over the content this frame. */
  front?: Record<Side, boolean>;
  /** How much the wings are typing (0 … 1, eased). */
  typing?: number;
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
  /** The mark on the page this wing glides after (client px), null = rest. */
  at: { x: number; y: number } | null;
  weight: number;
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
  useLayoutEffect(() => {
    penguin.position.set(0, 0, 0);
    penguin.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(penguin);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    penguin.position.set(-c.x, -box.min.y, -c.z);
    dims.current = { height: s.y };
    holder.rotation.order = 'ZYX';
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
      wings: { L: { bone: findNode(penguin, 'wing.L'), at: null, weight: 0 }, R: { bone: findNode(penguin, 'wing.R'), at: null, weight: 0 } } as Record<Side, Wing>,
    }),
    [penguin],
  );
  const handLength = useMemo(() => findNode(penguin, 'socket.hand.R')?.position.length() ?? 0.265, [penguin]);

  // the props live in the scene; the stamp hangs from the left wing's tip (the wing nearest the card)
  const stamp = useMemo(() => makeStamp(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rod = useMemo(() => makeRod(palette), []); // eslint-disable-line react-hooks/exhaustive-deps
  const erasers = useMemo(() => [makeEraser(), makeEraser()], []);
  const grip = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    stamp.recolor(palette);
    rod.recolor(palette);
  }, [palette, stamp, rod]);
  useLayoutEffect(() => {
    grip.position.set(0, handLength, 0);
    rig.wings.L.bone?.add(grip);
    grip.add(stamp.group);
    stamp.group.scale.setScalar(0.0001);
    rod.group.scale.setScalar(0.0001);
    scene.add(rod.group, ...erasers);
    return () => {
      grip.removeFromParent();
      rod.group.removeFromParent();
      for (const e of erasers) e.removeFromParent();
    };
  }, [rig, scene, stamp, rod, erasers, grip, handLength]);
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
  const p = useRef({ stamp: 0, rod: 0, acting: 0, typing: 0 });
  const move = useRef<{ act: SectionId | null; from: Spot | null; at: number; cur: Spot | null }>({ act: null, from: null, at: 0, cur: null });
  const fps = useRef({ n: 0, at: 0 });
  const drawn = useRef<'waiting' | 'drawn' | 'empty'>('waiting');
  const running = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = now();
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // the 2D poster gives way only once the penguin is really on screen
    if (drawn.current === 'waiting') {
      running.current += dt;
      drawn.current = drawState(state.gl.info.render.calls, running.current);
      if (drawn.current === 'drawn') onReady();
      else if (drawn.current === 'empty') onFail();
    }

    const cp = clipPose.current;
    rig.head?.quaternion.copy(cp.head);
    for (const side of ['L', 'R'] as const) rig.wings[side].bone?.quaternion.copy(cp[side]);
    rig.body?.scale.copy(cp.scale);
    mixer.update(dt);
    if (rig.head) cp.head.copy(rig.head.quaternion);
    for (const side of ['L', 'R'] as const) {
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
    toWorld(cur.x, cur.y, 0, holder.position);
    lights.current?.position.copy(holder.position);

    // the stamp's hit squashes the body a little
    const stampMs = t - cues.stampAt;
    if (rig.body && act === 'control') {
      const sy = squashAt(stampMs);
      if (sy !== 1) rig.body.scale.multiply(tmp.v.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy)));
    }

    // gaze: measured from the head; a lit card wins while acting; toned down while acting
    const head = headOf(cur);
    const gazeEl = live ? slide?.querySelector('[data-gaze]') : null;
    const px = gazeEl ? centre(gazeEl) : pointer.current;
    const ptr = touch && !gazeEl ? wander(t / 1000) : px ? { x: (px.x - head.x) / (rect.width * 0.5 || 1), y: (px.y - head.y) / (rect.height * 0.5 || 1) } : { x: 0, y: 0 };
    const want = lookAt(ptr);
    const calm = 1 - pp.acting * (1 - GAZE_ACTING);
    want.body *= calm;
    want.yaw *= calm;
    want.pitch = want.pitch * calm + ACT_PITCH * pp.acting;
    look.current = follow(look.current, want, dt);
    const l = look.current;
    holder.rotation.set(0, cur.turn + l.body, cur.lean);
    rig.head?.quaternion.multiply(tmp.q.setFromEuler(tmp.e.set(l.pitch, l.yaw, 0, 'YXZ')));
    holder.updateMatrixWorld(true);

    // ── the wings: a page point each (or a world point for the rod), and which may show in front ──
    const mark = (sel: string) => slide?.querySelector(sel) ?? null;
    const marks: Record<Side, { x: number; y: number } | null> = { L: null, R: null };
    const strength: Record<Side, number> = { L: 1, R: 1 };
    const allowed = FRONT[act];
    let rodKnob: THREE.Vector3 | null = null;
    if (live && content) {
      const edge = content.top + 0.015 * H;
      if (act === 'hero') {
        marks.L = { x: cur.x + REACH * H, y: edge };
        marks.R = { x: cur.x - REACH * H, y: edge };
      } else if (act === 'what') {
        const hand = mark('[data-hand="R"]');
        if (hand) marks.R = centre(hand);
        strength.R = relayHand(t - cues.relayAt);
      } else if (act === 'control') {
        const target = mark('[data-stamp-target]');
        if (target) marks.L = centre(target);
      } else if (act === 'start') {
        marks.L = { x: cur.x + REACH * H, y: edge };
        marks.R = { x: cur.x - REACH * H, y: edge };
      }
    }

    // team: the rod along the paper's top edge, at the depth the right wing reaches its left knob
    const rodMark = live && act === 'team' ? mark('[data-rod]') : null;
    const sheet = mark('.landing-scroll');
    const wingR = rig.wings.R.bone;
    if (rodMark && sheet && wingR) {
      const c = centre(rodMark);
      const width = sheet.getBoundingClientRect().width / zoom;
      const knobX = c.x - (width / 2 + 0.022) * zoom;
      wingR.getWorldPosition(tmp.shoulder);
      const r = handLength * (wingR.getWorldScale(tmp.w).y || 1);
      reach(rayAt(knobX, c.y, rect, camera, tmp.ray), tmp.shoulder, r, tmp.goal);
      toWorld(c.x, c.y, tmp.goal.z, rod.group.position);
      rod.group.position.y += tugAt(t - cues.unrollAt) * dims.current.height;
      rod.setLength(width);
      rodKnob = tmp.v.copy(rod.group.position).add(tmp.w.set(-width / 2 - 0.022, 0, 0)).clone();
    }

    const frontNow: Record<Side, boolean> = { L: false, R: false };
    for (const side of ['L', 'R'] as const) {
      const wing = rig.wings[side];
      const bone = wing.bone;
      if (!bone) continue;
      const goalMark = side === 'R' && rodKnob ? null : marks[side];
      const wanted = (goalMark || (side === 'R' && rodKnob) ? 1 : 0) * pp.acting;
      if (act === 'what' && side === 'R') wing.weight = wanted * strength.R;
      else wing.weight += (wanted - wing.weight) * k(WING_WEIGHT_RATE);
      if (goalMark) wing.at = wing.at ? { x: wing.at.x + (goalMark.x - wing.at.x) * k(WING_GLIDE), y: wing.at.y + (goalMark.y - wing.at.y) * k(WING_GLIDE) } : { ...goalMark };
      if (wing.weight < 0.002) continue;
      frontNow[side] = allowed.includes(side) && wing.weight > 0.05;

      bone.getWorldPosition(tmp.shoulder);
      bone.localToWorld(tmp.tip.copy(tmp.tipLocal).multiplyScalar(handLength));
      const r = tmp.tip.distanceTo(tmp.shoulder);

      if (side === 'R' && rodKnob) {
        tmp.goal.copy(rodKnob);
      } else if (wing.at) {
        let { x, y } = wing.at;
        if (act === 'hero') {
          // pretend typing: small alternating strokes above the keys, eased in and out with the box
          y += pp.typing * (-STROKE_LIFT * H + (STROKE_LIFT + STROKE_DEPTH) * H * strokeAt(t / 1000, side));
        } else if (act === 'start' && side === 'L') {
          const w = waveAt(t - cues.waveAt);
          x += w.raise * 0.17 * H + w.swing * WAVE_SWING * H;
          y -= w.raise * 0.42 * H;
        } else if (act === 'control' && side === 'L') {
          x -= STAMP_ASIDE * H * stampAside(stampMs);
        }
        rayAt(x, y, rect, camera, tmp.ray);
        if (act === 'control' && side === 'L') {
          tmp.hang.set(0, STAMP_LENGTH + stampLift(stampMs), 0);
          reach(tmp.ray, tmp.shoulder, r, tmp.goal, tmp.hang);
        } else reach(tmp.ray, tmp.shoulder, r, tmp.goal);
      } else continue;
      aim(bone, tmp.shoulder, tmp.tip, tmp.goal, wing.weight);
    }
    front.set(frontNow);

    // props: grow in for their act, shrink away after
    pp.stamp += ((act === 'control' && live ? 1 : 0) - pp.stamp) * k(6);
    pp.rod += ((rodKnob ? 1 : 0) - pp.rod) * k(6);
    stamp.group.scale.setScalar(Math.max(0.0001, pp.stamp));
    rod.group.scale.setScalar(Math.max(0.0001, pp.rod));
    if (pp.stamp > 0.001) {
      // upright in the world whatever the wing does, leaning back as it rises
      grip.getWorldQuaternion(tmp.q).invert();
      stamp.group.quaternion.copy(tmp.q).multiply(new THREE.Quaternion().setFromEuler(tmp.e.set(stampMs > 0 && stampMs < STAMP_TOTAL_MS ? stampTilt(stampMs) : 0, 0, 0)));
    }

    // wipe the body out behind the content of each slide that is showing (two while they cross-fade)
    let used = 0;
    if (stage && acting) {
      for (const el of stage.querySelectorAll<HTMLElement>('.landing-slide')) {
        if (used >= erasers.length) break;
        const opacity = parseFloat(getComputedStyle(el).opacity || '0');
        if (opacity < 0.01) continue;
        let box: { left: number; top: number; right: number; bottom: number } | null = null;
        let ground = false;
        for (const f of el.querySelectorAll<HTMLElement>('[data-front]')) {
          const r = f.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (f.dataset.front === 'ground') ground = true;
          box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        if (!box) continue;
        // `ground`: the penguin stands behind this card — nothing of it shows under the card either
        if (ground) box.bottom = Math.max(box.bottom, rect.bottom);
        const eraser = erasers[used++];
        fitEraser(eraser, box, 1, rect, camera, tmp.ray);
        // a card that is still fading in already hides the body (no penguin seen through it)
        eraser.material.opacity = Math.min(1, opacity * ERASE_GAIN);
        eraser.visible = true;
      }
    }
    for (let i = used; i < erasers.length; i++) erasers[i].visible = false;

    if (stats) {
      const toPage = (v: THREE.Vector3) => {
        const n = v.project(camera);
        return { x: Math.round((rect.left + ((n.x + 1) / 2) * rect.width) * 10) / 10, y: Math.round((rect.top + ((1 - n.y) / 2) * rect.height) * 10) / 10 };
      };
      stats.calls = state.gl.info.render.calls;
      stats.spot = { ...cur, settled };
      if (rig.body) stats.body = toPage(rig.body.getWorldPosition(new THREE.Vector3()));
      const tips = {} as Record<Side, { x: number; y: number }>;
      for (const side of ['L', 'R'] as const) {
        const bone = rig.wings[side].bone;
        if (bone) tips[side] = toPage(bone.localToWorld(new THREE.Vector3(0, handLength, 0)));
      }
      stats.tips = tips;
      stats.front = frontNow;
      stats.typing = Math.round(pp.typing * 100) / 100;
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
