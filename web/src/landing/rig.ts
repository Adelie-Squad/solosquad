// The geometry that lets the 3D penguin touch HTML (DESIGN.md `## 랜딩` — 연기): a point on the page
// becomes a ray from the camera; a wing reaches the front-most point of that ray it can (its tip
// moves on a sphere around the shoulder); the bone turns so its tip points there. And the content
// in front of the penguin is cut out of the canvas by an invisible quad (`makeEraser`) at a depth in
// front of the body — so the body is hidden behind the HTML card while a wing or a prop in front
// of that depth stays on top of it. Part of the lazily loaded 3D chunk.
import * as THREE from 'three';

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
 * A quad that erases what is already drawn behind it — the canvas is transparent, so the HTML
 * card under the canvas shows through. Depth-tested and drawn after everything opaque: a wing or a
 * prop nearer the camera than the quad keeps its pixels. `opacity` = how much it erases (the card
 * fading in and out).
 */
export function makeEraser(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthTest: true,
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
  mesh.renderOrder = 10;
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
