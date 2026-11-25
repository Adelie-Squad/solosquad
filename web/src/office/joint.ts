// The penguin's wing joint (asset contract §5 — 날개 관절). The wing is a rigid paddle on a hinge
// at the shoulder: it raises about the body's front–back axis (−8° … 112°) and twists a little
// about its own length (±15°); it never swings forward — a pose that wants the wing in front turns
// the whole body. Where it meets the body, a smooth-union fillet (`penguin.joint.L/R`) changes
// shape with the hinge angle: one morph target per (raise, twist) grid point, weighted here from
// the wing bone every frame — the same decomposition and bilinear rule as the build script
// (assets/office/scripts/penguin_v3.py `update_welt`). Without it the fillet would stay in its
// rest shape while the wing moves.
//
// All angles are measured in the rig's own frame (the GLB's armature node, glTF axes: x = the
// penguin's left, y = up, z = its front). three.js only; part of the lazily loaded 3D chunks.
import * as THREE from 'three';
import { PENGUIN_2D } from '../characters/colors';
import { JOINT_MESH, PENGUIN_RIG, WING_LIMITS } from './contract';

/** A descendant by asset name (three strips `.` from names; the GLB's own name stays in userData — kit.ts `nameOf`). */
function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && o !== root && ((o.userData?.name as string | undefined) ?? o.name) === name) hit = o;
  });
  return hit;
}

export type Side = 'L' | 'R';
const SIDES: readonly Side[] = ['L', 'R'];
const DEG = Math.PI / 180;
const Z = new THREE.Vector3(0, 0, 1);
/** The fillet's white (the wing's inner face, fixed — DESIGN.md: the face white never follows the theme). */
const JOINT_WHITE = new THREE.Color(PENGUIN_2D.face);

const installed = new WeakSet<THREE.Material>();

/** Raise and twist (degrees) of an armature-space wing rotation `l`; `e0` = the wing's rest axis (shoulder → tip). */
export function hingeAngles(l: THREE.Quaternion, e0: THREE.Vector3, side: Side): { raise: number; twist: number } {
  const s = side === 'L' ? 1 : -1;
  const e1 = e0.clone().applyQuaternion(l);
  const raise = (Math.atan2(s * e1.x, -e1.y) - Math.atan2(s * e0.x, -e0.y)) / DEG;
  // what is left after taking the raise out is the twist about the wing's own axis
  const rr = new THREE.Quaternion().setFromAxisAngle(Z, s * raise * DEG);
  const q = rr.invert().multiply(l);
  const twist = (2 * Math.atan2(q.x * e0.x + q.y * e0.y + q.z * e0.z, q.w) * s) / DEG;
  return { raise, twist: wrap(twist) };
}

const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** The armature-space rotation of a wing at (raise, twist) — penguin_v3 `_wing_raise`, clamped to the limits. */
export function hingeQuat(raise: number, twist: number, e0: THREE.Vector3, side: Side, out = new THREE.Quaternion()): THREE.Quaternion {
  const s = side === 'L' ? 1 : -1;
  const r = clampRaise(raise);
  const t = clampTwist(twist);
  const qr = new THREE.Quaternion().setFromAxisAngle(Z, s * r * DEG);
  const qt = new THREE.Quaternion().setFromAxisAngle(e0, s * t * DEG);
  return out.copy(qr).multiply(qt);
}

export const clampRaise = (deg: number) => Math.max(-WING_LIMITS.lower, Math.min(WING_LIMITS.raise, deg));
export const clampTwist = (deg: number) => Math.max(-WING_LIMITS.twist, Math.min(WING_LIMITS.twist, deg));

/** The two grid points either side of `x` and their weights (`x` clamped to the grid). */
export function bracket(grid: readonly number[], x: number): [number, number, number, number] {
  const v = Math.max(grid[0], Math.min(grid[grid.length - 1], x));
  let i = 0;
  while (i < grid.length - 2 && grid[i + 1] <= v) i++;
  const j = Math.min(i + 1, grid.length - 1);
  const t = i === j ? 0 : (v - grid[i]) / (grid[j] - grid[i]);
  return [i, 1 - t, j, t];
}

/** The morph target name of a grid point — `welt.+008.-15` (build script `build_welt`). */
export const targetName = (raise: number, twist: number) => `welt.${sign(raise, 3)}.${sign(twist, 2)}`;
const sign = (v: number, digits: number) => `${v < 0 ? '-' : '+'}${String(Math.abs(v)).padStart(digits, '0')}`;

/** What the fillet shader needs of both wings: each wing's bone index in the skeleton and its rest frame (rig space). */
export interface JointFrames {
  idx: Record<Side, number>;
  /** The wing-local (u, v, w) of the fillet's bind-space position p: m · p + c (rows u, v, w). */
  m: Record<Side, THREE.Matrix3>;
  c: Record<Side, THREE.Vector3>;
  rim: number;
  /** The root arc: centre u, semi-axes (u, v), and the rounding radius where it meets the rim. */
  arc: THREE.Vector4;
  /** The rim inset's widening towards the root: (extra, u0, u1) — penguin_v3 `wing_rim`. */
  taper: THREE.Vector3;
  /** The radius the fillet's white corners are rounded by (its row cut against the rim). */
  corner: number;
}

/**
 * The fillet's white, per pixel — the draft's own rule (penguin_v3 round 12): the rows next to the
 * wing (vertex attribute `_joint_white` > 0) AND inside the wing's white face, tested in the POSED
 * wing's own frame: the vertex shader takes the skinned position back through the wing bone's skin
 * matrix to the wing's rest frame and measures it along the wing's face normal (`-w - rim > 0`, the
 * same field as the wing's own white edge). So the fillet's white continues the wing's white edge
 * exactly in every pose. Per-face colours left a sawtooth where the fillet lies over the wing.
 * Installed on whatever material the fillet wears now — the office swaps in theme variants, the
 * landing its own copies (chained onto their onBeforeCompile, not replacing it).
 */
export function installJointWhite(mesh: THREE.Mesh, frames: JointFrames): void {
  if (!mesh.geometry.getAttribute('_joint_white') || !mesh.geometry.getAttribute('_joint_side')) return;
  for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    // a WeakSet, not userData: a clone copies userData but not onBeforeCompile
    if (installed.has(mat)) continue;
    installed.add(mat);
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      Object.assign(shader.uniforms, {
        uJointWhite: { value: JOINT_WHITE },
        uJointIdxL: { value: frames.idx.L },
        uJointIdxR: { value: frames.idx.R },
        uJointML: { value: frames.m.L },
        uJointMR: { value: frames.m.R },
        uJointCL: { value: frames.c.L },
        uJointCR: { value: frames.c.R },
        uJointArc: { value: frames.arc },
        uJointTaper: { value: frames.taper },
        uJointCorner: { value: frames.corner },
        uJointRim: { value: frames.rim },
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          ['#include <common>', 'attribute float _joint_white;', 'attribute float _joint_side;', 'uniform float uJointIdxL;', 'uniform float uJointIdxR;', 'uniform mat3 uJointML;', 'uniform mat3 uJointMR;', 'uniform vec3 uJointCL;', 'uniform vec3 uJointCR;', 'varying float vJointRow;', 'varying vec3 vJointQ;'].join('\n'),
        )
        .replace(
          '#include <skinning_vertex>',
          [
            '#include <skinning_vertex>',
            'vJointRow = _joint_white;',
            'vJointQ = vec3(0.0, 0.0, 1.0);',
            '#ifdef USE_SKINNING',
            '{',
            '  bool jl = _joint_side > 0.0;',
            '  mat4 jm = getBoneMatrix(jl ? uJointIdxL : uJointIdxR);',
            // back through the wing's skin matrix: mesh space -> bind space (skinned = bindMatrixInverse · jm · bindMatrix · bind)
            '  vec4 jp = inverse(bindMatrix) * inverse(jm) * inverse(bindMatrixInverse) * vec4(transformed, 1.0);',
            '  vJointQ = (jl ? uJointML : uJointMR) * jp.xyz + (jl ? uJointCL : uJointCR);',
            '}',
            '#endif',
          ].join('\n'),
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', ['#include <common>', 'uniform vec3 uJointWhite;', 'uniform float uJointRim;', 'uniform vec4 uJointArc;', 'uniform vec3 uJointTaper;', 'uniform float uJointCorner;', 'varying float vJointRow;', 'varying vec3 vJointQ;'].join('\n'))
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            // penguin_v3.wing_under_piece: smin(rim inset, root arc, round) > 0
            '{',
            '  float jt = clamp((vJointQ.x - uJointTaper.y) / (uJointTaper.z - uJointTaper.y), 0.0, 1.0);',
            '  jt = jt * jt * jt * (jt * (jt * 6.0 - 15.0) + 10.0);',
            '  float jr = -vJointQ.z - (uJointRim + uJointTaper.x * (1.0 - jt));',
            '  vec2 je = vec2((vJointQ.x - uJointArc.x) / uJointArc.y, vJointQ.y / uJointArc.z);',
            '  float ja = (1.0 - length(je)) * min(uJointArc.y, uJointArc.z);',
            '  float jh = max(uJointArc.w - abs(jr - ja), 0.0) / uJointArc.w;',
            '  float jw = min(jr, ja) - jh * jh * uJointArc.w * 0.25;',
            // round 13: the row cut and the face meet in a rounded corner (smin), not a sharp white tip
            '  float jk = max(uJointCorner, 1e-5);',
            '  float jg = max(jk - abs(vJointRow - jw), 0.0) / jk;',
            '  if (min(vJointRow, jw) - jg * jg * jk * 0.25 > 0.0) diffuseColor.rgb = uJointWhite;',
            '}',
          ].join('\n'),
        );
    };
    mat.customProgramCacheKey = () => `${prevKey.call(mat)}|joint-white`;
    mat.needsUpdate = true;
  }
}

interface Wing {
  side: Side;
  bone: THREE.Object3D;
  /** The wing's rest axis in the rig frame (from the joint node's extras). */
  e0: THREE.Vector3;
  /** The wing's rest rotation relative to the body, and the body's rest rotation in the rig frame. */
  rel0: THREE.Quaternion;
  body0: THREE.Quaternion;
  /** The fillet's meshes (one per material primitive — GLTFLoader puts them under the named node) and the grid. */
  joint: { meshes: THREE.Mesh[]; raise: number[]; twist: number[]; index: number[][] } | null;
}

export interface Joints {
  /** Re-weight the fillets from the wings' current pose (after the mixer / any wing aim). */
  update(): void;
  /** Put a wing back on its hinge: keep only the raise and twist of its current pose, within the limits. */
  clamp(side: Side): void;
  /** The current (raise, twist) of a wing, degrees. */
  angles(side: Side): { raise: number; twist: number };
  /** Pose a wing on its hinge directly (degrees from rest, clamped to the limits). */
  set(side: Side, raise: number, twist: number): void;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();

/**
 * Set up the joints of one penguin clone. Call it on the clone at rest (before any clip plays):
 * the rest rotations are read now. A penguin without joint meshes (the placeholder) still gets
 * `clamp` and `angles` from its wing bones.
 */
export function makeJoints(penguin: THREE.Object3D): Joints {
  penguin.updateMatrixWorld(true);
  const rig = findNode(penguin, PENGUIN_RIG) ?? penguin;
  const body = findNode(penguin, 'body');
  const rigQ = rig.getWorldQuaternion(new THREE.Quaternion());
  const wings: Wing[] = [];
  const frames: JointFrames = {
    idx: { L: -1, R: -1 },
    m: { L: new THREE.Matrix3(), R: new THREE.Matrix3() },
    c: { L: new THREE.Vector3(), R: new THREE.Vector3() },
    rim: 0.005,
    // no arc in the GLB: one that never cuts (the rim rule alone)
    arc: new THREE.Vector4(0, 1e3, 1e3, 1e-3),
    taper: new THREE.Vector3(0, 0, 1),
    corner: 0,
  };
  for (const side of SIDES) {
    const bone = findNode(penguin, `wing.${side}`);
    if (!bone || !body) continue;
    const node = findNode(penguin, `${JOINT_MESH}.${side}`);
    const extras = (node?.userData ?? {}) as { joint_e0?: number[]; joint_raise?: number[]; joint_twist?: number[] };
    const bodyQ = body.getWorldQuaternion(new THREE.Quaternion());
    const wingQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const rel0 = bodyQ.clone().invert().multiply(wingQ);
    const body0 = rigQ.clone().invert().multiply(bodyQ);
    // the rest axis: from the extras, else from the bone itself (its +Y, in the rig frame)
    const e0 = extras.joint_e0 ? new THREE.Vector3().fromArray(extras.joint_e0).normalize() : new THREE.Vector3(0, 1, 0).applyQuaternion(rigQ.clone().invert().multiply(wingQ)).normalize();
    let joint: Wing['joint'] = null;
    const meshes: THREE.Mesh[] = [];
    node?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) meshes.push(m);
    });
    if (meshes.length && extras.joint_raise && extras.joint_twist) {
      const dict = meshes[0].morphTargetDictionary!;
      const index = extras.joint_twist.map((t) => extras.joint_raise!.map((r) => dict[targetName(r, t)] ?? -1));
      joint = { meshes, raise: extras.joint_raise, twist: extras.joint_twist, index };
    }
    const ex = (node?.userData ?? {}) as { joint_pivot?: number[]; joint_eu?: number[]; joint_ev?: number[]; joint_ew?: number[]; joint_rim?: number; joint_arc?: number[]; joint_taper?: number[]; joint_corner?: number };
    if (typeof ex.joint_rim === 'number') frames.rim = ex.joint_rim;
    if (ex.joint_arc?.length === 4) frames.arc.fromArray(ex.joint_arc);
    if (ex.joint_taper?.length === 3) frames.taper.fromArray(ex.joint_taper);
    if (typeof ex.joint_corner === 'number') frames.corner = ex.joint_corner;
    const skinned = meshes.find((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
    if (skinned && ex.joint_pivot && ex.joint_ew) {
      const i = skinned.skeleton.bones.findIndex((b) => b === bone);
      frames.idx[side] = i;
      // bind space -> the mesh's own (rig) space at rest: the bone's skin matrix at rest. It is not the
      // identity: meshopt quantization folds the dequantisation into the inverse bind matrices.
      const d = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, skinned.skeleton.boneInverses[i]);
      d.premultiply(skinned.bindMatrixInverse).multiply(skinned.bindMatrix);
      const piv = new THREE.Vector3().fromArray(ex.joint_pivot);
      const ew = new THREE.Vector3().fromArray(ex.joint_ew);
      const eu = ex.joint_eu ? new THREE.Vector3().fromArray(ex.joint_eu) : new THREE.Vector3();
      const ev = ex.joint_ev ? new THREE.Vector3().fromArray(ex.joint_ev) : new THREE.Vector3();
      // q = A · (L · p + t − piv), A = rows (eu, ev, ew)
      const A = new THREE.Matrix3().set(eu.x, eu.y, eu.z, ev.x, ev.y, ev.z, ew.x, ew.y, ew.z);
      const lin = new THREE.Matrix3().setFromMatrix4(d);
      frames.m[side].multiplyMatrices(A, lin);
      frames.c[side].setFromMatrixPosition(d).sub(piv).applyMatrix3(A);
    }
    wings.push({ side, bone, e0, rel0, body0, joint });
  }
  for (const w of wings) for (const m of w.joint?.meshes ?? []) installJointWhite(m, frames);

  /** The wing's armature-space delta from rest: body0 · (body⁻¹ · wing) · rel0⁻¹ · body0⁻¹. */
  const delta = (w: Wing, out: THREE.Quaternion) => {
    // the bone's parent is the body bone: its local rotation is the rotation relative to the body
    out.copy(w.bone.quaternion).multiply(qa.copy(w.rel0).invert());
    return out.premultiply(w.body0).multiply(qb.copy(w.body0).invert());
  };

  const angles = (side: Side) => {
    const w = wings.find((x) => x.side === side);
    if (!w) return { raise: 0, twist: 0 };
    return hingeAngles(delta(w, qc), w.e0, side);
  };

  const put = (w: Wing, raise: number, twist: number) => {
    hingeQuat(raise, twist, w.e0, w.side, qc);
    // back to the bone's local rotation: body0⁻¹ · L · body0 · rel0
    w.bone.quaternion.copy(qb.copy(w.body0).invert()).multiply(qc).multiply(w.body0).multiply(w.rel0);
    w.bone.updateMatrixWorld(true);
  };

  return {
    angles,
    clamp(side) {
      const w = wings.find((x) => x.side === side);
      if (!w) return;
      const { raise, twist } = hingeAngles(delta(w, qc), w.e0, side);
      put(w, raise, twist);
    },
    set(side, raise, twist) {
      const w = wings.find((x) => x.side === side);
      if (w) put(w, raise, twist);
    },
    update() {
      for (const w of wings) {
        const j = w.joint;
        if (!j) continue;
        const { raise, twist } = hingeAngles(delta(w, qc), w.e0, w.side);
        for (const m of j.meshes) installJointWhite(m, frames);
        const inf = j.meshes[0].morphTargetInfluences!;
        inf.fill(0);
        const [ri, rw, rj, rt] = bracket(j.raise, raise);
        const [ti, tw, tj, tt] = bracket(j.twist, twist);
        for (const [t, a] of [
          [ti, tw],
          [tj, tt],
        ] as const) {
          for (const [r, b] of [
            [ri, rw],
            [rj, rt],
          ] as const) {
            const k = j.index[t][r];
            if (k >= 0) inf[k] += a * b;
          }
        }
        // the other primitives of the fillet share the weights
        for (let m = 1; m < j.meshes.length; m++) j.meshes[m].morphTargetInfluences!.splice(0, inf.length, ...inf);
      }
    },
  };
}
