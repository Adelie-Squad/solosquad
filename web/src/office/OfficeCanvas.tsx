// The clay office in React Three Fiber (DESIGN.md `## 사무실 장면` v3) — the lazily loaded part
// of the office screen: three.js, R3F, drei and the two GLBs load only here. OfficeStage owns
// the page side (tags, controls, fallback, pausing); this draws, applies the zoom controller's
// view, and reports back.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Theme } from '../theme';
import { seatClicks } from './clicks';
import { checkGltf, formatReport, type GltfJson } from './contract';
import { applyLook, buildOffice, KIT_LAYER, MaterialBank, playStatus, type Office } from './kit';
import type { Room, SeatAgent } from './layout';
import { paletteFor, type OfficePalette } from './palette';
import { kitUrl, penguinUrl, withMeshopt } from './penguinAsset';
import { SkyLight } from './SkyLight';
import type { AgentStatus } from './state';
import { collidingTags, floorPoint, officeFrame, tagsShowAll, VIEW_DIR, type TagBox, type ZoomController } from './zoom';

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
  /** Team labels under each pod (pod key → element), placed like the tags. */
  teamTags: RefObject<Map<string, HTMLElement>>;
  /** Where the camera looks (levels, pan) — the page drives it, the scene applies it. */
  zoom: ZoomController;
  onSelect: (agent: string) => void;
  onHover: (agent: string | null) => void;
  /** The pods as laid out (team labels follow them). */
  onPods: (pods: { key: string; team: string | null; chief: boolean }[]) => void;
  onReady: () => void;
  onFail: () => void;
  /** `?office-debug` — frames per second land here. */
  stats?: { fps: number };
}

/** Elevation 30°, azimuth 45° (contract §2) — the direction from the room towards the camera. */
const VIEW = new THREE.Vector3(...VIEW_DIR);
/** Pixels between the anchor above the head and the tag's bottom — the same at every zoom. */
const TAG_GAP = 8;

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

/** Stage pixels of a projected point. */
function toScreen(v: THREE.Vector3, size: { width: number; height: number }): [number, number] {
  return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
}

function Scene({ agents, statuses, theme, reducedMotion, mobile, tags, teamTags, zoom, onSelect, onHover, onPods, onReady, stats }: OfficeCanvasProps) {
  const kit = useGLTF(kitUrl, false, false, withMeshopt);
  const penguin = useGLTF(penguinUrl, false, false, withMeshopt);
  const { size, raycaster, invalidate, gl } = useThree();
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
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
  useEffect(() => {
    onPods(office.pods.map((p) => ({ key: p.key, team: p.team, chief: p.desks.some((d) => d.chief) })));
  }, [office, onPods]);

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

  const v = useMemo(() => new THREE.Vector3(), []);
  const fps = useRef({ n: 0, at: 0 });
  /** Measured tag sizes (px) — re-read now and then, not every frame (a layout read costs). */
  const sizes = useRef(new WeakMap<HTMLElement, { w: number; h: number; at: number }>());
  const frameNo = useRef(0);
  useFrame((state, dt) => {
    if (zoom.tick()) applyView(camera, zoom);
    if (!reducedMotion) for (const seat of office.seats.values()) seat.mixer.update(Math.min(dt, 0.05));
    const n = ++frameNo.current;
    // tags keep one pixel size at every zoom (DESIGN — 12px floor); below L3 a tag that would
    // cover a more important one is hidden instead of drawn smaller
    const collide = !tagsShowAll(zoom.level());
    const boxes: (TagBox & { el: HTMLElement })[] = [];
    for (const seat of office.seats.values()) {
      const el = seat.tag ?? tags.current?.get(seat.name) ?? null;
      seat.tag = el;
      if (!el) continue;
      seat.tagAnchor.getWorldPosition(v).project(state.camera);
      const [x, y] = toScreen(v, state.size);
      el.style.transform = `translate(${x.toFixed(1)}px, ${(y - TAG_GAP).toFixed(1)}px) translate(-50%, -100%)`;
      if (!collide || el.classList.contains('is-quiet')) {
        if (el.dataset.covered) delete el.dataset.covered;
        continue;
      }
      let box = sizes.current.get(el);
      if (!box || n - box.at > 30) {
        box = { w: el.offsetWidth, h: el.offsetHeight, at: n };
        sizes.current.set(el, box);
      }
      boxes.push({ el, name: seat.name, x, y: y - TAG_GAP, w: box.w, h: box.h, prio: Number(el.dataset.prio ?? 5) });
    }
    if (boxes.length) {
      const hidden = collidingTags(boxes);
      for (const b of boxes) {
        if (hidden.has(b.name)) b.el.dataset.covered = '1';
        else if (b.el.dataset.covered) delete b.el.dataset.covered;
      }
    }
    // team labels sit on the floor just in front of their pod
    for (const pod of office.pods) {
      const el = teamTags.current?.get(pod.key);
      if (!el) continue;
      v.set(pod.x, 0, pod.z + pod.d / 2 + 0.12).project(state.camera);
      const [x, y] = toScreen(v, state.size);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
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
    gl.domElement.style.cursor = name ? 'pointer' : '';
    onHover(name);
  };

  // one click opens the agent (after a beat, in case a second click follows); a double-click
  // zooms to that agent's desk (L5) instead
  const clicks = useMemo(() => seatClicks({ onSelect: (a) => onSelect(a), onFocus: (a) => void zoom.focusAgent(a) }), [onSelect, zoom]);
  useEffect(() => clicks.cancel, [clicks]);

  const room = office.room;
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  return (
    <>
      <CameraRig room={room} office={office} zoom={zoom} />
      <SkyLight color={palette.sky.ambient} intensity={palette.sky.ambientIntensity} />
      <KeyLight room={room} sky={palette.sky} mobile={mobile} rebuild={office} zoom={zoom} />
      <primitive
        object={office.root}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          const name = agentOf(e);
          if (!name) return;
          e.stopPropagation();
          clicks.click(name, e.nativeEvent.detail, e.delta);
        }}
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          const name = agentOf(e);
          if (!name) return;
          e.stopPropagation();
          clicks.dblclick(name);
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

/** Apply the controller's view: the frustum is cut around (u, v) in view coordinates, then zoomed. */
function applyView(camera: THREE.OrthographicCamera, zoom: ZoomController) {
  const f = zoom.frame;
  if (!f) return;
  const { u, v } = zoom.view;
  Object.assign(camera, { left: u - f.fit.w / 2, right: u + f.fit.w / 2, top: v + f.fit.h / 2, bottom: v - f.fit.h / 2, zoom: zoom.view.zoom });
  camera.updateProjectionMatrix();
}

/**
 * Orthographic camera at the contract's view, on the VIEW line through the origin — so the view
 * coordinates of zoom.ts are the frustum's own. The levels are measured from this layout at this
 * stage size; the controller keeps its level and centre across a resize.
 */
function CameraRig({ room, office, zoom }: { room: Room; office: Office; zoom: ZoomController }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const reach = Math.hypot(room.maxX - room.minX, room.maxZ - room.minZ) + Math.hypot(room.minX + room.maxX, room.minZ + room.maxZ) / 2;
    const dist = 40 + reach;
    (camera as THREE.OrthographicCamera & { manual?: boolean }).manual = true;
    camera.layers.enable(KIT_LAYER);
    camera.position.copy(VIEW).multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
    camera.near = 0.1;
    camera.far = dist * 2 + 10;
    camera.updateMatrixWorld();
    zoom.setFrame(officeFrame(office.pods, room, size.width, size.height, office.desk));
    applyView(camera, zoom);
    invalidate();
  }, [camera, room, office, zoom, size.width, size.height, invalidate]);
  // a demand-driven loop (reduced motion) still redraws when the view moves
  useEffect(() => zoom.subscribe((e) => e === 'change' && invalidate()), [zoom, invalidate]);
  return null;
}

/**
 * The one key light (`clay.sky`): by day the sun, the only shadow caster — its map covers what
 * is in view (the whole room at L1) and is drawn again only when the zoom or the pan settles,
 * never per frame of a drag, since only the penguins move and they bring their own contact
 * shadow; in the evening a weak moon rim from behind, no shadow.
 */
function KeyLight({ room, sky, mobile, rebuild, zoom }: { room: Room; sky: OfficePalette['sky']; mobile: boolean; rebuild: unknown; zoom: ZoomController }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const light = useMemo(() => new THREE.DirectionalLight(), []);
  const [focus, setFocus] = useState<{ x: number; z: number; r: number } | null>(null);
  useEffect(
    () =>
      zoom.subscribe((e) => {
        if ((e !== 'settle' && e !== 'frame') || !zoom.frame) return;
        const f = zoom.frame;
        const { u, v, zoom: z } = zoom.view;
        const p = floorPoint(u, v);
        // the visible floor: w across, about 2·h deep (seen at 30°), with a margin for the next pan
        const r = Math.max(f.fit.w / z / 2, f.fit.h / z) * 1.25 + 1.5;
        setFocus((old) => (old && Math.abs(old.x - p.x) < 0.05 && Math.abs(old.z - p.z) < 0.05 && Math.abs(old.r - r) < 0.05 ? old : { x: p.x, z: p.z, r }));
      }),
    [zoom],
  );
  useLayoutEffect(() => {
    const whole = Math.hypot(room.maxX - room.minX, room.maxZ - room.minZ) / 2 + 1;
    const near = !!focus && focus.r < whole;
    const cx = near ? focus.x : (room.minX + room.maxX) / 2;
    const cz = near ? focus.z : (room.minZ + room.maxZ) / 2;
    const span = near ? focus.r : whole;
    const dir = new THREE.Vector3(...sky.from).normalize();
    light.color.set(sky.sun);
    light.intensity = sky.sunIntensity * Math.PI;
    light.position.set(cx, 0, cz).addScaledVector(dir, 20);
    light.target.position.set(cx, 0, cz);
    light.target.updateMatrixWorld();
    light.castShadow = sky.shadow;
    const mapSize = mobile ? 1024 : 2048;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 4;
    Object.assign(light.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 45 });
    light.shadow.camera.layers.enable(KIT_LAYER); // the kit lives on its own layer
    light.shadow.camera.updateProjectionMatrix();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [light, room, sky, mobile, gl, invalidate, rebuild, focus]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
