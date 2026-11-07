// The landing's 3D mascot — the lazily loaded part (three.js · R3F · drei · penguin.glb). One
// plain penguin from the office loader (office/penguinAsset.ts), coloured by the office palette
// (light = day, dark = evening overtime), playing the office's state clips. It turns its head
// and body a little towards the pointer, damped. MascotStage owns the page side.
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
import { GREETING, GREETING_SECONDS } from './sections';

preloadPenguin();

export interface Pointer {
  /** -1 (left) … 1 (right) of the viewport; 0 when there is no pointer. */
  x: number;
  /** -1 (top) … 1 (bottom). */
  y: number;
}

export interface MascotCanvasProps {
  clip: ClipName;
  theme: Theme;
  mobile: boolean;
  paused: boolean;
  pointer: RefObject<Pointer>;
  /** Whole-page scroll 0…1 — a slow turn as the page goes by. */
  scroll: RefObject<number>;
  greet: boolean;
  onReady: () => void;
  onFail: () => void;
  stats?: { fps: number };
}

/** Largest turns towards the pointer (radians) — small on purpose. */
const BODY_YAW = 0.22;
const HEAD_YAW = 0.38;
const HEAD_PITCH = 0.16;
/** Damping rate (1/s): about 0.35 s to settle. */
const DAMP = 6;

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

function Mascot({ clip, theme, pointer, scroll, greet, onReady, stats }: MascotCanvasProps) {
  const { penguin, clips } = useSoloPenguin();
  const palette = paletteFor(theme);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // the solo penguin's body gets its own material, so the office's shared one is never touched
  const bodies = useMemo(() => {
    const out: THREE.MeshStandardMaterial[] = [];
    penguin.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        if (!m.name.startsWith('penguin.body')) return m;
        const own = (m as THREE.MeshStandardMaterial).clone();
        out.push(own);
        return own;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
    return out;
  }, [penguin]);
  useLayoutEffect(() => {
    for (const m of bodies) m.color.set(palette.penguinBody);
  }, [bodies, palette]);
  useEffect(() => () => bodies.forEach((m) => m.dispose()), [bodies]);

  const holder = useMemo(() => {
    const g = new THREE.Group();
    g.add(penguin);
    return g;
  }, [penguin]);
  const head = useMemo(() => findNode(penguin, 'head'), [penguin]);

  // frame the penguin: its rest bounds, the camera a little above eye level
  useLayoutEffect(() => {
    penguin.position.set(0, 0, 0);
    penguin.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(penguin);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    penguin.position.set(-c.x, -box.min.y, -c.z);
    // headroom above for the jump and the raised wings (`done` · `waiting`), a little below for the feet
    const h = s.y * 1.6;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = size.width / Math.max(1, size.height);
    const dist = Math.max(h / 2 / Math.tan(fov / 2), (s.x * 1.7) / 2 / Math.tan(fov / 2) / aspect);
    const at = new THREE.Vector3(0, s.y * 0.66, 0);
    camera.position.set(0, at.y + dist * 0.12, dist);
    camera.lookAt(at);
    camera.updateProjectionMatrix();
  }, [penguin, camera, size.width, size.height]);

  const mixer = useMemo(() => new THREE.AnimationMixer(penguin), [penguin]);
  const actions = useMemo(() => new Map(clips.map((c) => [c.name as ClipName, mixer.clipAction(c)])), [clips, mixer]);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);
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

  useEffect(() => {
    onReady();
  }, [onReady]);

  const look = useRef({ body: 0, yaw: 0, pitch: 0 });
  const offset = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const fps = useRef({ n: 0, at: 0 });
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    if (greetUntil.current && clock.current >= greetUntil.current) {
      greetUntil.current = 0;
      play(clip);
    }
    // undo last frame's head turn before the mixer writes the clip pose (a clip without a head
    // track would otherwise keep adding it up)
    if (head) head.quaternion.multiply(offset.clone().invert());
    mixer.update(dt);

    const p = pointer.current ?? { x: 0, y: 0 };
    const k = 1 - Math.exp(-DAMP * dt);
    const sway = Math.sin((scroll.current ?? 0) * Math.PI * 2) * 0.08;
    const l = look.current;
    l.body += (p.x * BODY_YAW + sway - l.body) * k;
    l.yaw += (p.x * HEAD_YAW - l.yaw) * k;
    l.pitch += (p.y * HEAD_PITCH - l.pitch) * k;
    holder.rotation.y = l.body;
    if (head) {
      offset.setFromEuler(euler.set(l.pitch, l.yaw - l.body * 0.5, 0));
      head.quaternion.multiply(offset);
    }

    if (stats) {
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
