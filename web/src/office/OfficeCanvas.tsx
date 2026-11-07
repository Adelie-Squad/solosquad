// The clay office in React Three Fiber (DESIGN.md `## 사무실 장면` v3) — the lazily loaded part
// of the office screen: three.js, R3F, drei and the two GLBs load only here. OfficeStage owns
// the page side (tags, fallback, pausing); this draws and reports back.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Theme } from '../theme';
import { checkGltf, formatReport, type GltfJson } from './contract';
import { applyLook, buildOffice, KIT_LAYER, MaterialBank, playStatus, type Office } from './kit';
import { WALL_H, type Room, type SeatAgent } from './layout';
import { paletteFor, type OfficePalette } from './palette';
import { kitUrl, penguinUrl, withMeshopt } from './penguinAsset';
import { SkyLight } from './SkyLight';
import type { AgentStatus } from './state';

// Both files start loading together (the loader setup is shared with the landing's mascot — penguinAsset.ts).
useGLTF.preload(kitUrl, false, false, withMeshopt);
useGLTF.preload(penguinUrl, false, false, withMeshopt);

export interface OfficeCanvasProps {
  agents: SeatAgent[];
  statuses: Record<string, AgentStatus>;
  theme: Theme;
  reducedMotion: boolean;
  mobile: boolean;
  /** Hidden tab or scrolled off-screen — stop drawing. */
  paused: boolean;
  tags: RefObject<Map<string, HTMLElement>>;
  onSelect: (agent: string) => void;
  onHover: (agent: string | null) => void;
  onReady: () => void;
  onFail: () => void;
  /** `?office-debug` — frames per second land here. */
  stats?: { fps: number };
}

/** Elevation 30°, azimuth 45° (contract §2) — the direction from the room towards the camera. */
const VIEW = new THREE.Vector3(Math.sin(Math.PI / 4) * Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6));

export default function OfficeCanvas(props: OfficeCanvasProps) {
  const palette = paletteFor(props.theme);
  const { onFail } = props;
  return (
    <Canvas
      className="office-canvas"
      aria-hidden="true"
      orthographic
      flat
      dpr={props.mobile ? 1.5 : 2}
      frameloop={props.paused ? 'never' : props.reducedMotion ? 'demand' : 'always'}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      // one soft shadow map for the day sun; drawn on demand only (the kit does not move)
      shadows={{ enabled: true, type: THREE.PCFSoftShadowMap, autoUpdate: false }}
      camera={{ near: 0.1, far: 200, position: [20, 16, 20] }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          onFail();
        });
      }}
    >
      <color attach="background" args={[palette.backdrop]} />
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}

function agentOf(e: ThreeEvent<PointerEvent | MouseEvent>): string | null {
  for (const hit of e.intersections) {
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      if (o.userData.agent) return o.userData.agent as string;
      o = o.parent;
    }
  }
  return null;
}

function Scene({ agents, statuses, theme, reducedMotion, mobile, tags, onSelect, onHover, onReady, stats }: OfficeCanvasProps) {
  const kit = useGLTF(kitUrl, false, false, withMeshopt);
  const penguin = useGLTF(penguinUrl, false, false, withMeshopt);
  const { size, raycaster, invalidate, gl } = useThree();
  const palette = paletteFor(theme);
  const evening = !!palette.lamp;

  useEffect(() => {
    // the scene raycasts desks (kit layer) as well as penguins
    raycaster.layers.enable(KIT_LAYER);
  }, [raycaster]);

  // the contract check, in development: a missing name is a console warning, not a silent gap
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const reports = [checkGltf(kit.parser.json as GltfJson, 'kit'), checkGltf(penguin.parser.json as GltfJson, 'penguin')];
    const placeholder = [kit, penguin].some((g) => (g.parser.json as { asset?: { extras?: { placeholder?: boolean } } }).asset?.extras?.placeholder);
    if (reports.some((r) => r.missing.length)) console.warn(`[office] the GLBs break the asset contract\n${formatReport(reports)}`);
    else if (placeholder) console.info('[office] placeholder GLBs in use (web/office-placeholder) — real ones go to assets/office/export');
  }, [kit, penguin]);

  const bank = useMemo(() => new MaterialBank([kit.scene, penguin.scene], palette), [kit, penguin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => bank.dispose(), [bank]);

  // rebuild only when who sits where changes (or the stage changes shape a lot)
  const seatKey = agents.map((a) => `${a.name}@${a.team ?? ''}`).join('|');
  const aspectBucket = Math.round(Math.log(Math.max(1, size.width) / Math.max(1, size.height)) / 0.25);
  const office = useMemo<Office>(
    () => buildOffice({ kit, penguin }, agents, bank, Math.exp(aspectBucket * 0.25)),
    [kit, penguin, bank, seatKey, aspectBucket], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => office.dispose(), [office]);

  useLayoutEffect(() => {
    bank.setPalette(palette);
    invalidate();
  }, [bank, palette, invalidate]);

  // statuses → clip + lamp / screen looks
  useLayoutEffect(() => {
    for (const seat of office.seats.values()) {
      const st = statuses[seat.name] ?? 'idle';
      playStatus(seat, st, evening, reducedMotion);
      applyLook(seat, st, palette, bank);
    }
    invalidate();
  }, [office, statuses, evening, reducedMotion, palette, bank, invalidate]);

  // tag elements come and go with React; the seat keeps a pointer
  useEffect(() => {
    for (const seat of office.seats.values()) seat.tag = tags.current?.get(seat.name) ?? null;
  });

  useEffect(() => {
    onReady();
  }, [onReady]);

  const tagScale = useRef(1);
  const v = useMemo(() => new THREE.Vector3(), []);
  const fps = useRef({ n: 0, at: 0 });
  useFrame((state, dt) => {
    if (!reducedMotion) for (const seat of office.seats.values()) seat.mixer.update(Math.min(dt, 0.05));
    for (const seat of office.seats.values()) {
      const el = seat.tag ?? tags.current?.get(seat.name) ?? null;
      seat.tag = el;
      if (!el) continue;
      seat.tagAnchor.getWorldPosition(v).project(state.camera);
      const x = ((v.x + 1) / 2) * state.size.width;
      const y = ((1 - v.y) / 2) * state.size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${tagScale.current.toFixed(2)})`;
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

  const hovered = useRef<string | null>(null);
  const hover = (name: string | null) => {
    if (name === hovered.current) return;
    hovered.current = name;
    gl.domElement.style.cursor = name ? 'pointer' : 'default';
    onHover(name);
  };

  const room = office.room;
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  return (
    <>
      <CameraRig room={room} scale={tagScale} />
      <SkyLight color={palette.sky.ambient} intensity={palette.sky.ambientIntensity} />
      <KeyLight room={room} sky={palette.sky} mobile={mobile} rebuild={office} />
      <primitive
        object={office.root}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          const name = agentOf(e);
          if (name) {
            e.stopPropagation();
            onSelect(name);
          }
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => hover(agentOf(e))}
        onPointerOut={() => hover(null)}
      />
      <ContactShadows
        position={[cx, 0.003, cz]}
        scale={[room.maxX - room.minX, room.maxZ - room.minZ]}
        resolution={mobile ? 512 : 1024}
        blur={2.2}
        far={1.4}
        opacity={palette.contact.opacity}
        color={palette.contact.color}
      />
    </>
  );
}

/** Orthographic camera at the contract's view, the frustum fitted to the room (floor + walls). */
function CameraRig({ room, scale }: { room: Room; scale: RefObject<number> }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const center = new THREE.Vector3((room.minX + room.maxX) / 2, WALL_H / 3, (room.minZ + room.maxZ) / 2);
    (camera as THREE.OrthographicCamera & { manual?: boolean }).manual = true;
    camera.layers.enable(KIT_LAYER);
    camera.position.copy(center).addScaledVector(VIEW, 40);
    camera.lookAt(center);
    camera.near = 0.1;
    camera.far = 120;
    camera.zoom = 1;
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [room.minX, room.maxX]) {
      for (const z of [room.minZ, room.maxZ]) {
        for (const y of [0, WALL_H]) {
          p.set(x, y, z).applyMatrix4(view);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
    const pad = 0.12;
    let w = maxX - minX + pad * 2;
    let h = maxY - minY + pad * 2;
    const aspect = size.width / Math.max(1, size.height);
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    Object.assign(camera, { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 });
    camera.updateProjectionMatrix();
    // name tags shrink with the room so a full office stays readable
    scale.current = Math.min(1, Math.max(0.62, size.width / w / 70));
    invalidate();
  }, [camera, room, size.width, size.height, invalidate, scale]);
  return null;
}

/**
 * The one key light (`clay.sky`): by day the sun, the only shadow caster — its map covers the room
 * and is drawn once per build or theme, since only the penguins move and they bring their own
 * contact shadow; in the evening a weak moon rim from behind, no shadow.
 */
function KeyLight({ room, sky, mobile, rebuild }: { room: Room; sky: OfficePalette['sky']; mobile: boolean; rebuild: unknown }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const light = useMemo(() => new THREE.DirectionalLight(), []);
  useLayoutEffect(() => {
    const cx = (room.minX + room.maxX) / 2;
    const cz = (room.minZ + room.maxZ) / 2;
    const span = Math.hypot(room.maxX - room.minX, room.maxZ - room.minZ) / 2 + 1;
    const dir = new THREE.Vector3(...sky.from).normalize();
    light.color.set(sky.sun);
    light.intensity = sky.sunIntensity * Math.PI;
    light.position.set(cx, 0, cz).addScaledVector(dir, 20);
    light.target.position.set(cx, 0, cz);
    light.target.updateMatrixWorld();
    light.castShadow = sky.shadow;
    const size = mobile ? 1024 : 2048;
    light.shadow.mapSize.set(size, size);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 4;
    Object.assign(light.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 45 });
    light.shadow.camera.layers.enable(KIT_LAYER); // the kit lives on its own layer
    light.shadow.camera.updateProjectionMatrix();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [light, room, sky, mobile, gl, invalidate, rebuild]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
