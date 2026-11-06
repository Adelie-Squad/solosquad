// Office scene palettes (DESIGN.md `## 사무실 장면` — 장면 팔레트). Day = light theme, evening
// overtime = dark theme. Every set is [top, left, right] — the face-direction tones; colour
// management is off, so these hex values reach the screen as written. With
// characters/colors.ts this is the only TS file allowed to hold colour values.
import type { Theme } from '../theme';

export type Tone3 = readonly [string, string, string];

export interface OfficePalette {
  floor: string;
  /** ShadowMaterial colour + opacity — gives the table's shadow result colour on `floor`. */
  shadow: { color: string; opacity: number };
  ink: string;
  block: Tone3;
  white: Tone3;
  black: Tone3;
  plant: Tone3;
  point: Tone3;
  lens: Tone3;
  /** Laptop screen — day: plain blue face; evening: the glow that lights faces. */
  screen: string;
  /** Desk lamp bulb + its warm pool (evening only; null = lamps off). */
  lamp: { bulb: string; pool: string; poolOpacity: number } | null;
  penguin: { body: Tone3; face: Tone3; cheek: Tone3; eye: Tone3; stitch: string };
  /** Evening: how much the screen glow tints a working penguin's front, and how dark idle ones get. */
  glow: number;
  idleDim: number;
  /** Where the shadow-casting light sits — day: the sun, low and long; evening: lamps, short from above. */
  sun: readonly [number, number, number];
}

export const DAY: OfficePalette = {
  floor: '#D0C5A7',
  shadow: { color: '#1C1900', opacity: 0.5 },
  ink: '#111008',
  block: ['#E1DBC5', '#F0EDE8', '#7E6E3B'],
  white: ['#F4F1EA', '#F0EDE8', '#7E6E3B'],
  black: ['#2A2925', '#151410', '#0B0A07'],
  plant: ['#B3D64A', '#9AC22D', '#6E8A1F'],
  point: ['#4A8CF0', '#2C74E0', '#1B4FA6'],
  lens: ['#DDEBFB', '#C9DDF6', '#8FB0D8'],
  screen: '#2C74E0',
  lamp: null,
  penguin: {
    body: ['#3D3B35', '#2B2A26', '#1C1B17'],
    face: ['#FAF8F3', '#F3F0EA', '#C9BD98'],
    cheek: ['#F25CC8', '#E01FAE', '#A8137F'],
    eye: ['#1C1B17', '#151410', '#0F0E0B'],
    stitch: '#8E8676',
  },
  glow: 0,
  idleDim: 0,
  sun: [-9, 6.4, 2.6],
};

export const EVENING: OfficePalette = {
  floor: '#1C1E27',
  shadow: { color: '#000000', opacity: 0.55 },
  ink: '#08090C',
  block: ['#4A4B55', '#5B5C66', '#2A2B33'],
  white: ['#5B5C66', '#55565F', '#2A2B33'],
  black: ['#1E1F25', '#15161B', '#0D0E12'],
  plant: ['#5F7A2C', '#4E6822', '#33451A'],
  point: ['#5B8DE8', '#3E72D2', '#24489A'],
  lens: ['#8FA6C8', '#7C93B5', '#4E6080'],
  screen: '#8FB8FF',
  lamp: { bulb: '#FFC56B', pool: '#FFC56B', poolOpacity: 0.3 },
  penguin: {
    // one step darker body; the face stays white and the cheeks keep their colour (identity)
    body: ['#2E2C28', '#201F1C', '#141310'],
    face: ['#FAF8F3', '#F3F0EA', '#C9BD98'],
    cheek: ['#F25CC8', '#E01FAE', '#A8137F'],
    eye: ['#1C1B17', '#151410', '#0F0E0B'],
    stitch: '#8E8676',
  },
  glow: 0.35,
  idleDim: 0.2,
  sun: [-2.2, 12, 1.6],
};

export const paletteFor = (theme: Theme): OfficePalette => (theme === 'dark' ? EVENING : DAY);
