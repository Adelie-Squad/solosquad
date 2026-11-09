// The entrance's ball → penguin blend (DESIGN.md `## 랜딩` — 첫 등장, timeline in intro.ts). No new
// assets and no shape keys (penguin.glb has none): each of the landing penguin's materials gets a
// vertex-shader step before skinning that moves every vertex from a sphere round the body's centre
// (`ball`) to its own place, by `morph`. The sphere comes from the body's own bounds (the body mesh
// minus the vertices bound to the wings and feet — a volume-equal radius), never from fixed numbers,
// so a redesigned penguin (taller, new beak) gets its own ball. The face, beak, eyes, cheeks and feet
// (every material but the body) and the wings (by skin weight) sit just inside the ball and come out
// later (`parts`), so they grow out of it. The ball can be lifted (`setBall`) to rest on the top edge
// of the content the penguin stands behind. Part of the lazily loaded 3D chunk.
import * as THREE from 'three';

interface Uniforms {
  uMorph: { value: number };
  uParts: { value: number };
  uIsPart: { value: number };
  /** The ball's centre and the body's centre, in this mesh's geometry space. */
  uBall: { value: THREE.Vector3 };
  uCore: { value: THREE.Vector3 };
  /** The ball's radius in the holder's space, and geometry ⇄ holder (linear part) — a round ball even if the mesh is scaled unevenly. */
  uRadius: { value: number };
  uToHolder: { value: THREE.Matrix3 };
  uToGeometry: { value: THREE.Matrix3 };
  uWingA: { value: number };
  uWingB: { value: number };
}

interface Entry {
  uniforms: Uniforms;
  /** holder-local → this mesh's geometry space (at rest). */
  toGeometry: THREE.Matrix4;
}

export interface Morph {
  /** The body's centre and the ball's radius, in the holder's space (world units of the penguin). */
  core: THREE.Vector3;
  radius: number;
  /** Where the ball's centre is this frame (holder space) and how far along the blend is. */
  set(ball: THREE.Vector3, morph: number, parts: number): void;
  dispose(): void;
}

const isProp = (o: THREE.Object3D) => (o.name || '').startsWith('prop.');

/** Bones named like the wings and feet (the landing reads `wing.L` · `wing.R`; older rigs `wingL`). */
const boneIndex = (skeleton: THREE.Skeleton, names: string[]) => skeleton.bones.findIndex((b) => names.includes(b.name));

/**
 * Set up the blend on the penguin's skinned meshes (call after the penguin is placed in `holder`,
 * world matrices current, at rest). Replaces each material with an own copy — the cached penguin is
 * shared with the office, its materials must stay untouched.
 */
export function makeMorph(penguin: THREE.Object3D, holder: THREE.Object3D): Morph | null {
  const meshes: THREE.SkinnedMesh[] = [];
  penguin.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && !m.userData.landingFront && !isProp(m)) meshes.push(m);
  });
  const body = meshes.find((m) => (Array.isArray(m.material) ? m.material : [m.material]).some((x) => x.name.startsWith('penguin.body')));
  if (!body) return null;
  holder.updateMatrixWorld(true);
  const toHolder = (m: THREE.Object3D) => new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(m.matrixWorld);

  // the body's bounds without the wings and the feet: the trunk and the head
  const sk = body.skeleton;
  const skip = [boneIndex(sk, ['wing.L', 'wingL']), boneIndex(sk, ['wing.R', 'wingR']), boneIndex(sk, ['foot.L', 'footL']), boneIndex(sk, ['foot.R', 'footR'])].filter((i) => i >= 0);
  const pos = body.geometry.getAttribute('position');
  const idx = body.geometry.getAttribute('skinIndex');
  const wgt = body.geometry.getAttribute('skinWeight');
  const bodyToHolder = toHolder(body);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let off = 0;
    if (idx && wgt) for (let k = 0; k < 4; k++) if (skip.includes(idx.getComponent(i, k))) off += wgt.getComponent(i, k);
    if (off > 0.5) continue;
    box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(bodyToHolder));
  }
  if (box.isEmpty()) return null;
  const core = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  // the sphere with the trunk's volume (an ellipsoid of these half-axes)
  const radius = Math.cbrt(half.x * half.y * half.z);

  const wingA = boneIndex(sk, ['wing.L', 'wingL']);
  const wingB = boneIndex(sk, ['wing.R', 'wingR']);
  const entries: Entry[] = [];
  const owned: THREE.Material[] = [];
  for (const mesh of meshes) {
    const toGeometry = toHolder(mesh).invert();
    const linear = new THREE.Matrix3().setFromMatrix4(toGeometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((src) => {
      const part = src.name.startsWith('penguin.body') ? 0 : 1;
      const uniforms: Uniforms = {
        uMorph: { value: 1 },
        uParts: { value: 1 },
        uIsPart: { value: part },
        uBall: { value: core.clone().applyMatrix4(toGeometry) },
        uCore: { value: core.clone().applyMatrix4(toGeometry) },
        uRadius: { value: radius },
        uToHolder: { value: linear.clone().invert() },
        uToGeometry: { value: linear },
        uWingA: { value: wingA },
        uWingB: { value: wingB },
      };
      entries.push({ uniforms, toGeometry });
      const own = (src as THREE.MeshStandardMaterial).clone();
      own.name = src.name;
      own.userData.landing = true;
      own.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            ['#include <common>', 'uniform float uMorph;', 'uniform float uParts;', 'uniform float uIsPart;', 'uniform vec3 uBall;', 'uniform vec3 uCore;', 'uniform float uRadius;', 'uniform mat3 uToHolder;', 'uniform mat3 uToGeometry;', 'uniform float uWingA;', 'uniform float uWingB;'].join('\n'),
          )
          .replace(
            '#include <beginnormal_vertex>',
            [
              '#include <beginnormal_vertex>',
              'float lWing = 0.0;',
              '#ifdef USE_SKINNING',
              'lWing = dot(skinWeight, vec4(equal(skinIndex, vec4(uWingA)))) + dot(skinWeight, vec4(equal(skinIndex, vec4(uWingB))));',
              '#endif',
              'float lPart = max(uIsPart, smoothstep(0.3, 0.7, lWing));',
              'float lMorph = mix(uMorph, uParts, lPart);',
              // the direction from the body's centre, in the holder's space (round there)
              'vec3 lDir = uToHolder * (position - uCore);',
              'lDir = length(lDir) > 1e-6 ? normalize(lDir) : vec3(0.0, 1.0, 0.0);',
              // a sphere's normal, back in geometry space (normals go by the transpose)
              'objectNormal = normalize(mix(normalize(transpose(uToHolder) * lDir), objectNormal, lMorph));',
            ].join('\n'),
          )
          .replace(
            '#include <begin_vertex>',
            // the parts wait just inside the body as it changes (round the centre it is moving to), so they grow out of it
            [
              '#include <begin_vertex>',
              'vec3 lCentre = mix(uBall, mix(uBall, uCore, uMorph), lPart);',
              'transformed = mix(lCentre + uToGeometry * (lDir * uRadius * mix(1.0, 0.86, lPart)), transformed, lMorph);',
            ].join('\n'),
          );
      };
      own.customProgramCacheKey = () => 'landing-morph';
      owned.push(own);
      return own;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  }

  return {
    core,
    radius,
    set(ball, morph, parts) {
      for (const e of entries) {
        e.uniforms.uMorph.value = morph;
        e.uniforms.uParts.value = parts;
        e.uniforms.uBall.value.copy(ball).applyMatrix4(e.toGeometry);
      }
    },
    dispose() {
      for (const m of owned) m.dispose();
    },
  };
}
