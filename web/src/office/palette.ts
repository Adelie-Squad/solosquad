// Office scene palettes (DESIGN.md `## 사무실 장면` — 장면 팔레트, v3 clay). Day = light theme,
// evening overtime = dark theme. Keys follow the material names of the asset contract, so the
// scene recolours a GLB by name and never reloads it. Starting values — the Blender style frame
// replaces them with measured ones (DESIGN.md table and this file change together; the design
// sync test compares them). With characters/colors.ts this is the only TS file allowed to hold
// colour values.
import type { Theme } from '../theme';

/** Materials the web paints per theme (contract §4); `team_*` take the team colour instead. */
export type ClayMaterial = 'clay.wall' | 'clay.floor' | 'clay.furniture' | 'clay.wood' | 'clay.plant' | 'clay.screen' | 'clay.lamp_bulb';

export interface OfficePalette {
  /** `clay.backdrop` — the plain colour outside the open room. */
  backdrop: string;
  /** Base colour per material name. */
  materials: Record<ClayMaterial, string>;
  /** Evening: a working agent's laptop screen glows this colour (null = no glow, day). */
  screenGlow: string | null;
  /** Evening desk lamp: bulb glow and its warm pool on the desk (null = lamps off and hidden). */
  lamp: { bulb: string; pool: string; poolOpacity: number } | null;
  /** `clay.sky` — the soft environment light and the one weak key light. */
  sky: { ambient: string; ambientIntensity: number; sun: string; sunIntensity: number };
  /** The penguin's contact shadow on the floor. */
  contact: { color: string; opacity: number };
  /** `clay.penguin_body` — material `penguin.body` in this theme (face, cheeks and eyes keep the GLB's colour — identity). */
  penguinBody: string;
  /** Evening: idle penguins sink into the dark by this much (0 = not at all). */
  idleDim: number;
}

const DAY_FURNITURE = '#F7F5F0';
const EVENING_BACKDROP = '#15161B';

export const DAY: OfficePalette = {
  backdrop: '#EEE9DF',
  materials: {
    'clay.wall': '#F4F1EA',
    'clay.floor': '#ECE7DE',
    'clay.furniture': DAY_FURNITURE,
    'clay.wood': '#D8C3A2',
    'clay.plant': '#8DB36B',
    'clay.screen': '#2C74E0',
    // lamps are hidden by day; an unlit bulb reads as furniture if one ever shows
    'clay.lamp_bulb': DAY_FURNITURE,
  },
  screenGlow: null,
  lamp: null,
  sky: { ambient: '#FFFFFF', ambientIntensity: 0.72, sun: '#FFF3E0', sunIntensity: 0.4 },
  contact: { color: '#1C1900', opacity: 0.32 },
  penguinBody: '#2B2A26',
  idleDim: 0,
};

export const EVENING: OfficePalette = {
  backdrop: EVENING_BACKDROP,
  materials: {
    'clay.wall': '#2B2D37',
    'clay.floor': '#23252E',
    'clay.furniture': '#3A3C47',
    'clay.wood': '#5A4E3E',
    'clay.plant': '#4E6A3A',
    // a screen that is off is as dark as the room around it
    'clay.screen': EVENING_BACKDROP,
    'clay.lamp_bulb': EVENING_BACKDROP,
  },
  screenGlow: '#8FB8FF',
  lamp: { bulb: '#FFC56B', pool: '#FFC56B', poolOpacity: 0.3 },
  // the evening tones are already dark — the light is weak and blue, the key light almost gone
  sky: { ambient: '#3A4566', ambientIntensity: 5.5, sun: '#3A4566', sunIntensity: 0.6 },
  contact: { color: '#000000', opacity: 0.45 },
  // lighter than by day, so the silhouette holds in the navy room (DESIGN.md `clay.penguin_body`)
  penguinBody: '#474855',
  idleDim: 0.35,
};

export const paletteFor = (theme: Theme): OfficePalette => (theme === 'dark' ? EVENING : DAY);
