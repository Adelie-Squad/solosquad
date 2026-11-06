// Role props in 3D (DESIGN.md `## 에이전트 캐릭터` — the body is shared, props attach).
// Two or three primitives each; positions follow the face layout of guide §8.3.
import * as THREE from 'three';
import type { Prop } from '../characters/roster';
import { box, cap, cyl, sph } from './geometry';

export type ToneKey = 'black' | 'white' | 'point' | 'lens' | 'gold' | 'team' | 'helmet';
export type Make = (geo: THREE.BufferGeometry, tone: ToneKey, pos: [number, number, number], parent: THREE.Object3D, opts?: { rot?: [number, number, number]; scale?: [number, number, number] }) => THREE.Mesh;

/** Attach `prop` to a penguin: `rig` = the body group, `rightWing` = the right wing pivot. */
export function addProp(prop: Prop, rig: THREE.Group, rightWing: THREE.Group, mk: Make): void {
  const inHand = () => {
    const tool = new THREE.Group();
    tool.position.set(0.06, -0.36, 0.13);
    tool.rotation.z = -0.35;
    rightWing.add(tool);
    return tool;
  };
  const glasses = (tone: ToneKey) => {
    for (const s of [-1, 1]) {
      mk(new THREE.TorusGeometry(0.13, 0.021, 10, 36), tone, [s * 0.155, 0.86, 0.31], rig);
      mk(box(0.02, 0.02, 0.22), tone, [s * 0.29, 0.87, 0.19], rig);
    }
    mk(cyl(0.015, 0.015, 0.06, 8), tone, [0, 0.88, 0.32], rig, { rot: [0, 0, Math.PI / 2] });
  };
  switch (prop) {
    case 'crown-bowtie': {
      mk(cyl(0.17, 0.2, 0.12, 5), 'gold', [0, 1.24, 0], rig);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        mk(new THREE.ConeGeometry(0.045, 0.12, 4), 'gold', [Math.sin(a) * 0.15, 1.35, Math.cos(a) * 0.15], rig);
      }
      for (const s of [-1, 1]) {
        mk(new THREE.ConeGeometry(0.075, 0.15, 4), 'team', [s * 0.075, 0.55, 0.345], rig, { rot: [Math.PI / 4, 0, s * Math.PI / 2], scale: [1, 1, 0.5] });
      }
      mk(sph(0.038, 16, 10), 'team', [0, 0.55, 0.36], rig);
      return;
    }
    case 'clipboard': {
      const t = inHand();
      mk(cap(0.3, 0.03, 0.4, 0.03, 0, 0.01), 'white', [0, 0.25, 0], t, { rot: [Math.PI / 2, 0, 0] });
      mk(box(0.12, 0.05, 0.04), 'team', [0, 0.45, 0.02], t);
      return;
    }
    case 'beret':
      mk(sph(0.3, 28, 12), 'team', [0.04, 1.14, -0.02], rig, { scale: [1.15, 0.32, 0.9], rot: [0, 0, -0.18] });
      mk(cyl(0.02, 0.02, 0.06, 8), 'black', [0.04, 1.25, -0.02], rig);
      return;
    case 'round-glasses':
      glasses('black');
      return;
    case 'gold-glasses': {
      glasses('gold');
      const t = inHand();
      mk(cap(0.24, 0.06, 0.32, 0.03, 0, 0.01), 'black', [0, 0.22, 0], t, { rot: [Math.PI / 2, 0, 0] });
      mk(box(0.16, 0.06, 0.012), 'lens', [0, 0.3, 0.035], t);
      return;
    }
    case 'chart': {
      const t = inHand();
      mk(cap(0.34, 0.03, 0.3, 0.03, 0, 0.01), 'white', [0, 0.25, 0], t, { rot: [Math.PI / 2, 0, 0] });
      [0.07, 0.13, 0.1].forEach((h, i) => mk(box(0.05, h, 0.02), 'team', [-0.09 + i * 0.09, 0.15 + h / 2, 0.03], t));
      return;
    }
    case 'beanie':
      mk(new THREE.SphereGeometry(0.33, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), 'team', [0, 1.0, 0], rig, { scale: [1, 0.85, 0.78] });
      mk(sph(0.07, 16, 10), 'white', [0, 1.3, 0], rig);
      return;
    case 'headset':
      mk(new THREE.TorusGeometry(0.37, 0.025, 8, 36, Math.PI), 'black', [0, 0.82, 0], rig);
      for (const s of [-1, 1]) mk(cyl(0.09, 0.09, 0.06, 20), 'team', [s * 0.39, 0.8, 0], rig, { rot: [0, 0, Math.PI / 2] });
      mk(cyl(0.012, 0.012, 0.3, 6), 'black', [-0.3, 0.68, 0.17], rig, { rot: [0.9, 0, 0.6] });
      return;
    case 'cube': {
      const t = inHand();
      mk(cap(0.24, 0.24, 0.24, 0.04, 0, 0.02), 'team', [0, 0.18, 0], t);
      return;
    }
    case 'hardhat':
      mk(new THREE.SphereGeometry(0.31, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), 'helmet', [0, 1.02, 0], rig, { scale: [1, 0.75, 0.82] });
      mk(cyl(0.37, 0.37, 0.03, 32), 'helmet', [0, 1.02, 0.02], rig, { scale: [1, 1, 0.82] });
      mk(cap(0.13, 0.03, 0.15, 0.05, 0, 0.01), 'team', [0.17, 0.55, 0.32], rig, { rot: [Math.PI / 2 - 0.2, 0, 0] });
      return;
    case 'magnifier': {
      const t = inHand();
      mk(cyl(0.022, 0.026, 0.24, 8), 'black', [0, 0.03, 0], t);
      mk(new THREE.TorusGeometry(0.14, 0.026, 10, 36), 'black', [0, 0.29, 0], t);
      mk(cyl(0.13, 0.13, 0.012, 36), 'lens', [0, 0.29, 0], t, { rot: [Math.PI / 2, 0, 0] });
      return;
    }
    case 'tie':
      mk(new THREE.ConeGeometry(0.06, 0.06, 4), 'team', [0, 0.57, 0.35], rig, { rot: [Math.PI, 0, 0], scale: [1, 1, 0.4] });
      mk(new THREE.ConeGeometry(0.07, 0.28, 4), 'team', [0, 0.4, 0.35], rig, { rot: [Math.PI, Math.PI / 4, 0], scale: [1, 1, 0.4] });
      return;
    case 'card': {
      const t = inHand();
      mk(box(0.26, 0.16, 0.015), 'white', [0, 0.22, 0], t);
      mk(box(0.14, 0.025, 0.02), 'team', [-0.03, 0.25, 0.005], t);
      return;
    }
    case 'megaphone': {
      const t = inHand();
      mk(cyl(0.05, 0.16, 0.3, 24), 'team', [0, 0.25, 0.08], t, { rot: [Math.PI / 2, 0, 0] });
      mk(cyl(0.03, 0.03, 0.12, 8), 'black', [0, 0.12, 0], t);
      return;
    }
    case 'brush': {
      const t = inHand();
      mk(cyl(0.018, 0.022, 0.32, 8), 'white', [0, 0.12, 0], t);
      mk(new THREE.ConeGeometry(0.04, 0.12, 12), 'team', [0, 0.33, 0], t);
      return;
    }
    case 'scarf':
      mk(new THREE.TorusGeometry(0.33, 0.06, 10, 40), 'team', [0, 0.6, 0], rig, { rot: [Math.PI / 2, 0, 0], scale: [1, 0.76, 1] });
      mk(box(0.1, 0.26, 0.04), 'team', [0.16, 0.45, 0.3], rig, { rot: [0.15, 0, 0.2] });
      return;
  }
}
