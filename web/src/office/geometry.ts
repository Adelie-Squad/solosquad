// Primitives of the keycap diorama (guide §5 · §8). No model files — everything is built here.
import * as THREE from 'three';

/** Rounded rectangle extruded with a two-step bevel and a taper: one ink line on the top rim. */
export function keycap(w: number, h: number, d: number, r: number, inset: number, bev: number): THREE.BufferGeometry {
  const sw = w - 2 * bev;
  const sd = d - 2 * bev;
  const rr = Math.max(0.01, r - bev);
  const x0 = -sw / 2;
  const y0 = -sd / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x0 + sw - rr, y0);
  s.absarc(x0 + sw - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x0 + sw, y0 + sd - rr);
  s.absarc(x0 + sw - rr, y0 + sd - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y0 + sd);
  s.absarc(x0 + rr, y0 + sd - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);
  s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * bev),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bev, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i)) / h;
    p.setX(i, p.getX(i) * (1 - (t * 2 * inset) / w));
    p.setZ(i, p.getZ(i) * (1 - (t * 2 * inset) / d));
  }
  g.computeVertexNormals();
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();
/** Geometry is shared between every desk and every penguin — build once per shape. */
export function shared(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

export function disposeShared(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

export const sph = (r: number, a = 32, b = 20) => shared(`sph:${r}:${a}:${b}`, () => new THREE.SphereGeometry(r, a, b));
export const cyl = (rt: number, rb: number, h: number, s = 32) =>
  shared(`cyl:${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
export const box = (w: number, h: number, d: number) => shared(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cap = (w: number, h: number, d: number, r: number, inset: number, bev: number) =>
  shared(`cap:${w}:${h}:${d}:${r}:${inset}:${bev}`, () => keycap(w, h, d, r, inset, bev));

/** The penguin body: a pear profile turned and pressed flat front-to-back (guide §8.2). */
export const penguinBody = () =>
  shared('penguin-body', () => {
    const pts: [number, number][] = [
      [0.001, 0.04],
      [0.3, 0.06],
      [0.43, 0.19],
      [0.47, 0.41],
      [0.45, 0.65],
      [0.39, 0.87],
      [0.29, 1.05],
      [0.15, 1.16],
      [0.001, 1.19],
    ];
    const g = new THREE.LatheGeometry(
      pts.map(([x, y]) => new THREE.Vector2(x, y)),
      56,
      Math.PI,
    );
    g.scale(1, 1, 0.74);
    g.computeVertexNormals();
    return g;
  });
