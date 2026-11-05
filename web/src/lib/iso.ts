// 아이소메트릭(30°) 투영 — 월드 좌표 (x, y, z) 를 SVG 화면 좌표로.
// x 가 늘면 오른쪽 아래, y 가 늘면 왼쪽 아래, z 가 늘면 위로 간다.

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

export type Pt = [number, number];

export function project(x: number, y: number, z = 0): Pt {
  return [(x - y) * COS, (x + y) * SIN - z];
}

export function points(pts: Pt[]): string {
  return pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
}

/** 상자의 보이는 세 면 — 윗면 · 왼쪽 앞면(y 끝) · 오른쪽 앞면(x 끝) */
export function boxFaces(x: number, y: number, z: number, w: number, d: number, h: number) {
  const P = (px: number, py: number, pz: number) => project(px, py, pz);
  return {
    top: points([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
    left: points([P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)]),
    right: points([P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)]),
  };
}

/** y 가 일정한 면(왼쪽 앞면) 위의 사각형 — 화면 · 슬롯 · 눈 */
export function faceY(y: number, x0: number, x1: number, z0: number, z1: number): string {
  return points([project(x0, y, z1), project(x1, y, z1), project(x1, y, z0), project(x0, y, z0)]);
}

/** x 가 일정한 면(오른쪽 앞면) 위의 사각형 */
export function faceX(x: number, y0: number, y1: number, z0: number, z1: number): string {
  return points([project(x, y0, z1), project(x, y1, z1), project(x, y1, z0), project(x, y0, z0)]);
}

/** 바닥(z 고정) 위의 사각형 */
export function faceZ(z: number, x0: number, y0: number, x1: number, y1: number): string {
  return points([project(x0, y0, z), project(x1, y0, z), project(x1, y1, z), project(x0, y1, z)]);
}
