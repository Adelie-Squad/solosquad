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
    wings.push({ side, bone, e0, rel0, body0, joint });
  }

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
