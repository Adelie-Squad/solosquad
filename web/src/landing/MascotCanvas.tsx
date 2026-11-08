// The landing's 3D mascot — the lazily loaded part (three.js · R3F · drei · penguin.glb). One
// plain penguin from the office loader (office/penguinAsset.ts), coloured by the office palette
// (light = day, dark = evening overtime), playing the office's state clips. On top of the clip:
// the head (and a little of the body) follows the cursor, and when a slide comes in the penguin
// turns to its content and raises the wing on that side. MascotStage owns the page side.
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
import { useHolder } from './holder';
import { drawState, follow, lookAt, wander, type Look, type Pointer } from './gaze';
import { GREETING, GREETING_SECONDS, PRESENT_DELAY_MS, presentWeight } from './sections';

preloadPenguin();

export type { Pointer };

/** Where the slide's content sits from the penguin: beside it (desktop) or under it (phone). */
export type PresentSide = 'right' | 'down';

export interface LandingStats {
  fps: number;
  /** Last frame's draw calls — 0 means nothing is on screen. */
  calls: number;
  /** Replays the presenting gesture (debug and screenshots). */
  present?: () => void;
}

export interface MascotCanvasProps {
  clip: ClipName;
  theme: Theme;
  mobile: boolean;
  paused: boolean;
  pointer: RefObject<Pointer | null>;
  /** No cursor (touch): a slow look around instead of following. */
  touch: boolean;
  /** Changes when a slide comes in — starts the presenting gesture. */
  slide: string;
  side: PresentSide;
  greet: boolean;
  onReady: () => void;
  onFail: () => void;
  stats?: LandingStats;
}

/** The turn towards the content while presenting (rad) — past the cursor limits on purpose. */
const PRESENT_LOOK: Record<PresentSide, Look> = {
  right: { body: 0.5, yaw: 0.12, pitch: 0.06 },
  down: { body: 0.18, yaw: 0.08, pitch: 0.3 },
};
/** How far the presenting wing lifts out to the side (rad). */
const WING_LIFT: Record<PresentSide, number> = { right: 1.15, down: 0.7 };

export default function MascotCanvas(props: MascotCanvasProps) {
  const { onFail } = props;
  return (
    <Canvas
      className="landing-canvas"
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

function Mascot({ clip, theme, pointer, touch, slide, side, greet, onReady, onFail, stats }: MascotCanvasProps) {
  const { penguin, clips } = useSoloPenguin();
  const palette = paletteFor(theme);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const holder = useHolder(penguin);
  useOwnBodyMaterial(penguin, palette.penguinBody);

  // frame the penguin: its rest bounds, the camera a little above eye level
  useLayoutEffect(() => {
    penguin.position.set(0, 0, 0);
    penguin.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(penguin);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    penguin.position.set(-c.x, -box.min.y, -c.z);
    // headroom above for the jump and the raised wings (`done` · `waiting`), room at the sides for the presenting wing
    const h = s.y * 1.45;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = size.width / Math.max(1, size.height);
    const dist = Math.max(h / 2 / Math.tan(fov / 2), (s.x * 2.1) / 2 / Math.tan(fov / 2) / aspect);
    const at = new THREE.Vector3(0, s.y * 0.64, 0);
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
  const greetUntil = useRef(greet ? GREETING_SECONDS : 0);
  const clock = useRef(0);

  const play = (name: ClipName) => {
    const next = actions.get(name) ?? actions.get('idle') ?? null;
    if (!next || next === current.current) return;
    const prev = current.current;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, CROSSFADE, false);
    current.current = next;
  };

  useLayoutEffect(() => {
    if (clock.current < greetUntil.current && clip === 'idle') play(GREETING);
    else {
      greetUntil.current = 0;
      play(clip);
    }
  }, [clip, actions]); // eslint-disable-line react-hooks/exhaustive-deps

  // presenting: restart the gesture whenever a slide comes in (not for the first one — the greeting is)
  const presentAt = useRef<number | null>(null);
  const firstSlide = useRef(slide);
  useEffect(() => {
    if (slide === firstSlide.current && presentAt.current === null) return;
    presentAt.current = clock.current;
  }, [slide]);
  useEffect(() => {
    if (stats) stats.present = () => void (presentAt.current = clock.current);
  }, [stats]);

  const bones = useMemo(
    () => ({ head: new Offset(findNode(penguin, 'head')), wing: new Offset(findNode(penguin, 'wing.L')) }),
    [penguin, side],
  );
  const look = useRef<Look>({ body: 0, yaw: 0, pitch: 0 });
  const q = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const fps = useRef({ n: 0, at: 0 });
  const drawn = useRef<'waiting' | 'drawn' | 'empty'>('waiting');
  const running = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    if (greetUntil.current && clock.current >= greetUntil.current) {
      greetUntil.current = 0;
      play(clip);
    }

    // the 2D poster gives way only once the penguin is really on screen
    if (drawn.current === 'waiting') {
      running.current += dt;
      drawn.current = drawState(state.gl.info.render.calls, running.current);
      if (drawn.current === 'drawn') onReady();
      else if (drawn.current === 'empty') onFail();
    }

    bones.head.undo();
    bones.wing.undo();
    mixer.update(dt);

    // gaze: the cursor (or a slow look around on touch), blended into the presenting turn
    const p = touch ? wander(clock.current) : (pointer.current ?? { x: 0, y: 0 });
    const since = presentAt.current === null ? -1 : clock.current - presentAt.current - PRESENT_DELAY_MS / 1000 + 0.2;
    const w = presentWeight(since);
    const want = lookAt(p);
    const turn = PRESENT_LOOK[side];
    const target: Look = {
      body: want.body + (turn.body - want.body) * w,
      yaw: want.yaw + (turn.yaw - want.yaw) * w,
      pitch: want.pitch + (turn.pitch - want.pitch) * w,
    };
    look.current = follow(look.current, target, dt);
    const l = look.current;
    holder.rotation.y = l.body;
    bones.head.apply(q.setFromEuler(euler.set(l.pitch, l.yaw, 0, 'YXZ')));
    // the wing lifts out to the side: the bone hangs down (local −Y), so a turn about its local Z
    bones.wing.apply(q.setFromEuler(euler.set(0, 0, -WING_LIFT[side] * w)));

    if (stats) {
      stats.calls = state.gl.info.render.calls;
      const now = state.clock.elapsedTime;
      fps.current.n++;
      if (now - fps.current.at >= 1) {
        stats.fps = Math.round(fps.current.n / (now - fps.current.at));
        fps.current = { n: 0, at: now };
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
