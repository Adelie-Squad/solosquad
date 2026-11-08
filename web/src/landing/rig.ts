// The geometry that lets the 3D penguin touch HTML (DESIGN.md `## 랜딩` — 연기 · 가림): a point on
// the page becomes a ray from the camera; a wing reaches the front-most point of that ray it can
// (its tip moves on a sphere around the shoulder); the bone turns so its tip points there. And the
// content hides the penguin's body in three passes: the penguin, then an invisible quad over each
// content box that wipes every pixel there (`makeEraser` — no depth test, so no pose can push a body
// part through it), then the wings allowed to touch the content drawn again on top
// (`useFrontPass` — a twin of the penguin's skinned meshes that keeps only those wings' fragments).
// Part of the lazily loaded 3D chunk.
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SectionId } from './sections';

export type Side = 'L' | 'R';

/**
 * The only body parts that may show in front of a section's content (the penguin's left wing is on
 * the reader's right): the two typing wings on the prompt box's top edge, the wing handing the
 * request to card 1, the wing on the scroll rod, the stamp wing, and on the last card the waving
 * wing and the one resting on its edge. Never the head, the body or the feet.
 */
export const FRONT: Record<SectionId, readonly Side[]> = {
  hero: ['L', 'R'],
  what: ['R'],
  team: ['R'],
  control: ['L'],
  start: ['L', 'R'],
};

/** Render order: the body (0) < the eraser (10) < the front wings and the props (20). */
export const ORDER = { eraser: 10, front: 20 } as const;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const qd = new THREE.Quaternion();
const qw = new THREE.Quaternion();
const qx = new THREE.Quaternion();
const goal = new THREE.Quaternion();

/** The camera ray through a point of the page (client px) over the canvas `rect`. */
export function rayAt(x: number, y: number, rect: DOMRect, camera: THREE.Camera, out: THREE.Ray): THREE.Ray {
  ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return out.copy(raycaster.ray);
}

/** Where `ray` crosses the plane z = `z` (world). */
export function atDepth(ray: THREE.Ray, z: number, out: THREE.Vector3): THREE.Vector3 {
  const t = Math.abs(ray.direction.z) < 1e-6 ? 0 : (z - ray.origin.z) / ray.direction.z;
  return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
}

/**
 * Where a wing tip goes to touch the ray: the front-most point of the ray at distance `r` from the
 * shoulder `s` (if the ray passes out of reach, the nearest point it can get to). `hang` lifts the
 * tip above the touching point — for a stamp held in the tip, whose face is `hang` below it.
 */
export function reach(ray: THREE.Ray, s: THREE.Vector3, r: number, out: THREE.Vector3, hang?: THREE.Vector3): THREE.Vector3 {
  const o = a.copy(ray.origin);
  if (hang) o.add(hang);
  const d = ray.direction;
  const os = b.copy(o).sub(s);
  const half = d.dot(os);
  const c = os.lengthSq() - r * r;
  const disc = half * half - c;
  const t = disc >= 0 ? -half - Math.sqrt(disc) : -half;
  out.copy(d).multiplyScalar(t).add(o).sub(s);
  return out.setLength(r).add(s);
}

/**
 * Turn `bone` (already posed by the clip, world matrices current) so that its tip — a point that
 * moves with it, now at `tip` — points from `pivot` towards `target`, by `weight` (0 … 1).
 */
export function aim(bone: THREE.Object3D, pivot: THREE.Vector3, tip: THREE.Vector3, target: THREE.Vector3, weight: number) {
  if (weight <= 0) return;
  const from = a.copy(tip).sub(pivot).normalize();
  const to = b.copy(target).sub(pivot).normalize();
  qd.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(qw);
  // world' = qd · world  →  local' = local · world⁻¹ · qd · world
  qx.copy(qw).invert().multiply(qd).multiply(qw);
  goal.copy(bone.quaternion).multiply(qx);
  bone.quaternion.slerp(goal, Math.min(1, weight));
  bone.updateMatrixWorld(true);
}

/**
 * A quad that erases what is already drawn under it — the canvas is transparent, so the HTML card
 * under the canvas shows through. Drawn after the body (transparent pass, `ORDER.eraser`) and before
 * the front wings and the props (`ORDER.front`). `opacity` = how much it erases — it follows a card
 * fading in or out, faster than the card itself (MascotCanvas `ERASE_GAIN`), so the body is never
 * seen through a half-faded card.
 */
export function makeEraser(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // no depth test: everything already drawn under the quad goes, whatever its depth
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = ORDER.eraser;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** Stretch an eraser over the page rect `box` (client px), at world depth `z`. */
export function fitEraser(mesh: THREE.Mesh, box: { left: number; top: number; right: number; bottom: number }, z: number, rect: DOMRect, camera: THREE.Camera, ray: THREE.Ray) {
  const pos = (mesh.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
  const corners: [number, number][] = [
    [box.left, box.top],
    [box.right, box.top],
    [box.right, box.bottom],
    [box.left, box.bottom],
  ];
  corners.forEach(([x, y], i) => {
    atDepth(rayAt(x, y, rect, camera, ray), z, a);
    pos.setXYZ(i, a.x, a.y, a.z);
  });
  pos.needsUpdate = true;
}

/**
 * The front pass: a twin of each of the penguin's skinned meshes, on the same skeleton, drawn after
 * the eraser. Its shader keeps only the fragments of the wings named in `set` (by skin weight —
 * more than half bound to that wing bone) and drops the rest, so the head, body and feet are never
 * drawn twice. Hidden when no wing is in front (no extra draw calls).
 */
export function useFrontPass(penguin: THREE.Object3D, bodyColor: string): { set(front: Record<Side, boolean>): void } {
  const uniforms = useMemo(() => ({ uFrontA: { value: -1 }, uFrontB: { value: -1 } }), []);
  const state = useMemo(() => ({ twins: [] as THREE.SkinnedMesh[], index: { L: -1, R: -1 } as Record<Side, number> }), []);
  useLayoutEffect(() => {
    const sources: THREE.SkinnedMesh[] = [];
    penguin.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !m.userData.landingFront && !(m.name || '').startsWith('prop.')) sources.push(m);
    });
    const made: THREE.SkinnedMesh[] = [];
    for (const src of sources) {
      const mats = (Array.isArray(src.material) ? src.material : [src.material]).map((m) => frontMaterial(m as THREE.MeshStandardMaterial, uniforms));
      const twin = new THREE.SkinnedMesh(src.geometry, Array.isArray(src.material) ? mats : mats[0]);
      twin.bind(src.skeleton, src.bindMatrix);
      twin.position.copy(src.position);
      twin.quaternion.copy(src.quaternion);
      twin.scale.copy(src.scale);
      twin.renderOrder = ORDER.front;
      twin.frustumCulled = false;
      twin.visible = false;
      twin.userData.landingFront = true;
      src.parent?.add(twin);
      made.push(twin);
      if (state.index.L < 0) {
        state.index.L = src.skeleton.bones.findIndex((b) => b.name === 'wing.L' || b.name === 'wingL');
        state.index.R = src.skeleton.bones.findIndex((b) => b.name === 'wing.R' || b.name === 'wingR');
      }
    }
    state.twins = made;
    return () => {
      for (const twin of made) {
        twin.removeFromParent();
        for (const m of Array.isArray(twin.material) ? twin.material : [twin.material]) m.dispose();
      }
      state.twins = [];
    };
  }, [penguin, uniforms, state]);
  // the twin's body colour follows the theme like the original's
  useLayoutEffect(() => {
    for (const twin of state.twins) {
      for (const m of Array.isArray(twin.material) ? twin.material : [twin.material]) {
        if (m.name.startsWith('penguin.body')) (m as THREE.MeshStandardMaterial).color.set(bodyColor);
      }
    }
  }, [bodyColor, state, penguin]);
  return useMemo(
    () => ({
      set(front: Record<Side, boolean>) {
        const on = (['L', 'R'] as const).filter((s) => front[s] && state.index[s] >= 0).map((s) => state.index[s]);
        uniforms.uFrontA.value = on[0] ?? -1;
        uniforms.uFrontB.value = on[1] ?? -1;
        for (const twin of state.twins) twin.visible = on.length > 0;
      },
    }),
    [uniforms, state],
  );
}

/** A copy of a penguin material that keeps only the fragments bound to the front wing bones. */
function frontMaterial(src: THREE.MeshStandardMaterial, uniforms: { uFrontA: { value: number }; uFrontB: { value: number } }): THREE.MeshStandardMaterial {
  const m = src.clone();
  m.name = src.name;
  // the transparent pass, so it draws after the eraser; fully opaque all the same
  m.transparent = true;
  m.opacity = 1;
  m.depthWrite = true;
  m.depthFunc = THREE.LessEqualDepth;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFrontA = uniforms.uFrontA;
    shader.uniforms.uFrontB = uniforms.uFrontB;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', 'uniform float uFrontA;', 'uniform float uFrontB;', 'varying float vFront;'].join('\n'))
      .replace(
        '#include <skinning_vertex>',
        [
          '#include <skinning_vertex>',
          '#ifdef USE_SKINNING',
          'vFront = dot(skinWeight, vec4(equal(skinIndex, vec4(uFrontA)))) + dot(skinWeight, vec4(equal(skinIndex, vec4(uFrontB))));',
          '#else',
          'vFront = 0.0;',
          '#endif',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', ['#include <common>', 'varying float vFront;'].join('\n'))
      .replace('void main() {', ['void main() {', '  if (vFront < 0.5) discard;'].join('\n'));
  };
  m.customProgramCacheKey = () => 'landing-front';
  return m;
}
