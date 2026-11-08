// The landing penguin's two props, made in three.js in the clay look of the office (DESIGN.md
// `## 사무실 장면` — matte, single colours from the `clay.*` palette, rounded, no outlines): a stamp
// (도장) held in the right wing, and the rod of the scroll (두루마리) held in both. Lathed profiles,
// so every edge is soft. Placeholders for proper Blender props (`prop.stamp` · `prop.scroll`,
// asset contract §5) — the web keeps the same names so the swap is a file drop.
import * as THREE from 'three';
import type { OfficePalette } from '../office/palette';

/** From the grip (the wing tip) down to the stamp's face (world units; the penguin is ≈ 0.78 tall). */
export const STAMP_LENGTH = 0.15;

/**
 * Matte clay. Drawn in the late (transparent) pass, after the eraser (rig.ts `makeEraser`): a prop is
 * held over the content, so the cut-out behind the content never takes a piece of it.
 */
const clay = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, transparent: true, opacity: 1, depthWrite: true });

/** Props draw after the eraser (renderOrder 10). */
const late = <T extends THREE.Object3D>(o: T): T => {
  o.renderOrder = 20;
  return o;
};

/** A lathe from (radius, height) pairs listed top to bottom (swept bottom-up, so the faces point out). */
function lathe(points: [number, number][], segments = 28): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points
      .slice()
      .reverse()
      .map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export interface Stamp {
  group: THREE.Group;
  /** The face's centre in the group's space — what meets the card. */
  face: THREE.Vector3;
  recolor(p: OfficePalette): void;
  dispose(): void;
}

/**
 * The stamp: a round knob on a waisted handle (wood) and a soft-edged block with its face
 * (furniture white). Origin = the grip at the top of the knob; it hangs down −Y.
 */
export function makeStamp(p: OfficePalette): Stamp {
  const wood = clay(p.materials['clay.wood']);
  const block = clay(p.materials['clay.furniture']);
  const group = new THREE.Group();
  group.name = 'prop.stamp';
  // knob + waist + flare (wood)
  const handle = new THREE.Mesh(
    lathe([
      [0.0001, 0],
      [0.016, -0.004],
      [0.026, -0.016],
      [0.027, -0.028],
      [0.02, -0.042],
      [0.011, -0.055],
      [0.011, -0.072],
      [0.022, -0.086],
      [0.03, -0.094],
      [0.0001, -0.094],
    ]),
    wood,
  );
  // the block: rounded top shoulder, straight sides, a soft lip at the face (furniture)
  const base = new THREE.Mesh(
    lathe([
      [0.0001, -0.09],
      [0.036, -0.091],
      [0.046, -0.098],
      [0.049, -0.108],
      [0.049, -0.138],
      [0.046, -0.146],
      [0.038, -0.15],
      [0.0001, -0.15],
    ]),
    block,
  );
  group.add(late(handle), late(base));
  return {
    group,
    face: new THREE.Vector3(0, -STAMP_LENGTH, 0),
    recolor(next) {
      wood.color.set(next.materials['clay.wood']);
      block.color.set(next.materials['clay.furniture']);
    },
    dispose() {
      handle.geometry.dispose();
      base.geometry.dispose();
      wood.dispose();
      block.dispose();
    },
  };
}

export interface Rod {
  group: THREE.Group;
  /** Length between the end knobs, world units (the paper's width). */
  setLength(length: number): void;
  recolor(p: OfficePalette): void;
  dispose(): void;
}

/** The scroll's rod: a wooden dowel along X with a round knob at each end. Origin = its middle. */
export function makeRod(p: OfficePalette): Rod {
  const wood = clay(p.materials['clay.wood']);
  const knobs = clay(p.materials['clay.furniture']);
  const group = new THREE.Group();
  group.name = 'prop.scroll';
  const dowel = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 1, 6, 20), wood);
  dowel.rotation.z = Math.PI / 2;
  const knobGeo = new THREE.SphereGeometry(0.03, 20, 14);
  const left = new THREE.Mesh(knobGeo, knobs);
  const right = new THREE.Mesh(knobGeo, knobs);
  group.add(late(dowel), late(left), late(right));
  const setLength = (length: number) => {
    dowel.scale.set(1, Math.max(0.05, length), 1);
    left.position.set(-length / 2 - 0.022, 0, 0);
    right.position.set(length / 2 + 0.022, 0, 0);
  };
  setLength(0.6);
  return {
    group,
    setLength,
    recolor(next) {
      wood.color.set(next.materials['clay.wood']);
      knobs.color.set(next.materials['clay.furniture']);
    },
    dispose() {
      dowel.geometry.dispose();
      knobGeo.dispose();
      wood.dispose();
      knobs.dispose();
    },
  };
}
