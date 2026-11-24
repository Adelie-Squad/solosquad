// The v3 penguin's wing joint (asset contract §5): the hinge angles the web reads from a wing bone
// round-trip, stay within the limits, and pick the fillet's morph targets bilinearly — the same rule
// as the build script (penguin_v3.update_welt). And the shipped GLB carries what the driver needs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { JOINT_MESH, readGlbJson, WING_LIMITS } from '../src/office/contract';
import { bracket, hingeAngles, hingeQuat, targetName } from '../src/office/joint';

// the left wing's rest axis in the rig frame (shoulder -> tip: down, out 31 deg, a little forward)
const e0 = new THREE.Vector3(0.4975, -0.8572, 0.1333).normalize();

describe('the wing hinge', () => {
  it('reads back the raise and twist it was posed with', () => {
    for (const side of ['L', 'R'] as const) {
      const e = side === 'L' ? e0 : e0.clone().setX(-e0.x);
      for (const [r, t] of [
        [0, 0],
        [40, 10],
        [100, -12],
        [112, 15],
        [-8, -15],
      ]) {
        const q = hingeQuat(r, t, e, side);
        const a = hingeAngles(q, e, side);
        expect(a.raise).toBeCloseTo(r, 3);
        expect(a.twist).toBeCloseTo(t, 3);
      }
    }
  });

  it('never goes past the limits: raise -8 … 112, twist ±15', () => {
    expect(WING_LIMITS).toEqual({ raise: 112, lower: 8, twist: 15 });
    const a = hingeAngles(hingeQuat(150, -40, e0, 'L'), e0, 'L');
    expect(a.raise).toBeCloseTo(WING_LIMITS.raise, 3);
    expect(a.twist).toBeCloseTo(-WING_LIMITS.twist, 3);
    const b = hingeAngles(hingeQuat(-30, 0, e0, 'L'), e0, 'L');
    expect(b.raise).toBeCloseTo(-WING_LIMITS.lower, 3);
  });

  it('weights the two grid points either side, like the build script', () => {
    const raise = [-8, 0, 8, 16, 24];
    expect(bracket(raise, 4)).toEqual([1, 0.5, 2, 0.5]);
    expect(bracket(raise, 24)).toEqual([3, 0, 4, 1]);
    expect(bracket(raise, 99)).toEqual([3, 0, 4, 1]);
    expect(bracket([-15, 0, 15], -12)).toEqual([0, 0.8, 1, expect.closeTo(0.2, 6)]);
    expect(targetName(96, -15)).toBe('welt.+096.-15');
    expect(targetName(-8, 0)).toBe('welt.-008.+00');
  });

  it('the shipped penguin.glb has both fillets with their grid and every target', () => {
    const json = readGlbJson(new Uint8Array(readFileSync(join(process.cwd(), '..', 'assets', 'office', 'export', 'penguin.glb'))));
    for (const side of ['L', 'R']) {
      const node = json.nodes!.find((n) => n.name === `${JOINT_MESH}.${side}`)!;
      expect(node).toBeTruthy();
      const ex = node.extras as { joint_raise: number[]; joint_twist: number[]; joint_e0: number[] };
      expect(ex.joint_raise[0]).toBe(-8);
      expect(ex.joint_raise[ex.joint_raise.length - 1]).toBeGreaterThanOrEqual(WING_LIMITS.raise);
      expect(ex.joint_twist).toEqual([-15, 0, 15]);
      const mesh = (json as unknown as { meshes: { extras?: { targetNames?: string[] } }[] }).meshes[node.mesh!];
      const names = new Set(mesh.extras?.targetNames ?? []);
      for (const t of ex.joint_twist) for (const r of ex.joint_raise) expect(names.has(targetName(r, t))).toBe(true);
    }
  });
});
