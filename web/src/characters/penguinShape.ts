// The penguin's front view (DESIGN.md `## 에이전트 캐릭터`) in icon units: viewBox 40, y down. The
// 3D build script uses the same numbers (assets/office/scripts/penguin.py FRONT · EYES · CHEEKS ·
// BEAK), so the icon and the office penguin are one character. Change both together.
//
// The whole body runs from the head top (y 5) to the feet (y ≈ 49). The icon shows it cut at the
// chest inside a ring; the mascot shows all of it.

/** Body silhouette: a tall pear — narrow shoulders, widest low, round bottom. */
export const BODY = 'M20 5C27.2 5 31.2 11 31.2 19.5C31.2 26 32.6 32 32.6 38.5C32.6 44.6 27.6 48 20 48C12.4 48 7.4 44.6 7.4 38.5C7.4 32 8.8 26 8.8 19.5C8.8 11 12.8 5 20 5Z';

/** Flippers on the body's sides. */
export const FLIPPERS = 'M8.7 24.5c-2 2.8-2.8 6.9-2.3 10.9l3.8-1.9z M31.3 24.5c2 2.8 2.8 6.9 2.3 10.9l-3.8-1.9z';

/**
 * The white front, forehead to bottom: one round arch into the forehead, a smooth curve beside the
 * eyes (no notch), a gentle concave waist at the belly, then out to the bottom (the 3D front wraps
 * under it).
 */
export const FRONT = 'M20 11C24.8 11 28.2 14.6 28.9 19.4C29.5 23.4 28.9 26.8 28 29.6C27.2 32.2 27.6 36.5 29.4 41.5C30.4 44.3 25.6 47.9 20 47.9C14.4 47.9 9.6 44.3 10.6 41.5C12.4 36.5 12.8 32.2 12 29.6C11.1 26.8 10.5 23.4 11.1 19.4C11.8 14.6 15.2 11 20 11Z';

/** The stitch 1.15 inside the front's edge — up one side, over the forehead, down the other (it stops where the front turns under). */
export const FRONT_STITCH =
  'M11.62 42.24L11.64 42.06L11.91 41.25L12.31 39.99L12.66 38.77L12.95 37.58L13.18 36.43L13.35 35.32L13.47 34.25L13.53 33.23L13.54 32.26L13.49 31.34L13.38 30.47L13.21 29.65L12.99 28.91L12.79 28.22L12.6 27.5L12.44 26.77L12.3 26.01L12.18 25.22L12.09 24.42L12.03 23.59L12.01 22.74L12.02 21.86L12.08 20.97L12.17 20.04L12.33 19.03L12.59 17.99L12.94 17.02L13.37 16.12L13.89 15.3L14.49 14.56L15.16 13.91L15.89 13.35L16.69 12.89L17.56 12.54L18.49 12.29L19.48 12.17L21.51 12.29L22.44 12.54L23.31 12.89L24.11 13.35L24.84 13.91L25.51 14.56L26.11 15.3L26.63 16.12L27.06 17.02L27.41 17.99L27.67 19.03L27.83 20.04L27.92 20.97L27.98 21.86L27.99 22.74L27.97 23.59L27.91 24.42L27.82 25.22L27.7 26.01L27.56 26.77L27.4 27.5L27.21 28.22L27.01 28.91L26.79 29.65L26.62 30.47L26.51 31.34L26.46 32.26L26.47 33.23L26.53 34.25L26.65 35.32L26.82 36.43L27.05 37.58L27.34 38.77L27.69 39.99L28.09 41.25L28.36 42.06L28.38 42.24';

type Circle = { cx: number; cy: number; r: number };

/** Eyes and cheeks are perfect circles; the eyes are larger than the cheeks. */
export const EYES: readonly Circle[] = [
  { cx: 16.2, cy: 18.4, r: 1.9 },
  { cx: 23.8, cy: 18.4, r: 1.9 },
];
export const CHEEKS: readonly Circle[] = [
  { cx: 14.2, cy: 22.4, r: 1.5 },
  { cx: 25.8, cy: 22.4, r: 1.5 },
];

/** The beak, a diamond seen from the front: the upper beak a triangle pointing up, the lower one pointing down. */
export const BEAK = { cx: 20, cy: 21.9, halfWidth: 2.6, up: 2.6, down: 3 } as const;
const n = (v: number) => +v.toFixed(2);
export const BEAK_PATH = `M${BEAK.cx} ${n(BEAK.cy - BEAK.up)}L${n(BEAK.cx + BEAK.halfWidth)} ${BEAK.cy}L${BEAK.cx} ${n(BEAK.cy + BEAK.down)}L${n(BEAK.cx - BEAK.halfWidth)} ${BEAK.cy}Z`;
/** Where the upper and lower beak meet. */
export const BEAK_SEAM = `M${n(BEAK.cx - BEAK.halfWidth + 0.7)} ${BEAK.cy}H${n(BEAK.cx + BEAK.halfWidth - 0.7)}`;

/** Black feet under the white belly (seen only in the full view). */
export const FEET: readonly { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 15.6, cy: 47.7, rx: 3.4, ry: 1.6 },
  { cx: 24.4, cy: 47.7, rx: 3.4, ry: 1.6 },
];

/** Face width at the eyes — eye and cheek sizes are given as ratios of it (DESIGN.md). */
export const FACE_WIDTH_AT_EYES = 17.5;

/** The mascot's framing: the whole body (head top 5 → feet 49.3) fitted into the 40 box. */
export const FULL_VIEW = 'translate(2.8 -3.3) scale(0.86)';
