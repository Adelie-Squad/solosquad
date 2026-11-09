// Office scene palettes (DESIGN.md `## 사무실 장면` — 장면 팔레트, v3 clay). Day = light theme,
// evening overtime = dark theme. Keys follow the material names of the asset contract, so the
// scene recolours a GLB by name and never reloads it. Starting values — the Blender style frame
// replaces them with measured ones (DESIGN.md table and this file change together; the design
// sync test compares them). With characters/colors.ts this is the only TS file allowed to hold
// colour values.
import type { Theme } from '../theme';

/** Materials the web paints per theme (contract §4); `team_*` take the team colour instead. */
export type ClayMaterial = 'clay.wall' | 'clay.floor' | 'clay.furniture' | 'clay.wood' | 'clay.plant' | 'clay.screen' | 'clay.lamp_bulb';

export interface AgentLight {
  color: string;
  intensity: number;
  /** Reach in metres (light falls to zero there). */
  distance: number;
}

export interface OfficePalette {
  /** `clay.backdrop` — the plain colour outside the open room. */
  backdrop: string;
  /** Base colour per material name. */
  materials: Record<ClayMaterial, string>;
  /** Evening: a working agent's laptop screen glows this colour (null = no glow, day). */
  screenGlow: string | null;
  /** Evening desk lamp: bulb glow and its warm pool on the desk (null = lamps off; by day they stand unlit). */
  lamp: { bulb: string; pool: string; poolOpacity: number } | null;
  /**
   * Evening per-agent lights (assets/office/README.md lighting): a warm point at the lamp and a
   * cool light from the screen towards the agent's face — on for a working agent, off for idle.
   * Null by day. Intensities are three.js candela, tuned on screen against the style frame.
   */
  agentLights: { lamp: AgentLight; screen: AgentLight } | null;
  /**
   * Evening room lights (`clay.night`, user 2026-11-10 — "야근할 때 너무 어두우니까 야간 조명"):
   * always on in the evening, so the room reads, while the desk lamps still say who is at work.
   * All in the lamp's warm colour, none casts a shadow. Null by day.
   */
  night: {
    /** A soft warm fill over the whole room — a hemisphere light: warm from above, the sky's navy from below. */
    fill: { sky: string; ground: string; intensity: number };
    /** One light high over the middle of the room, under the cut-away ceiling (no fixture — it would cover the back row). */
    ceiling: AgentLight & { height: number };
    /** A picture light on the wall above the whiteboard (a lit bar + its light). */
    board: AgentLight;
    /** Standing lamps by the sofa and the coffee bar (pole, glowing shade, their light). */
    floorLamp: AgentLight;
    /** The soft warm pool on the floor under each pod light and floor lamp. */
    poolOpacity: number;
  } | null;
  /**
   * `clay.sky` — the soft environment light and one key light: by day the sun (the only shadow
   * caster, drawn once for the still kit), in the evening a cool moon rim from behind and above.
   * `from` = direction towards the light.
   */
  sky: { ambient: string; ambientIntensity: number; sun: string; sunIntensity: number; from: readonly [number, number, number]; shadow: boolean };
  /** The penguin's contact shadow on the floor. */
  contact: { color: string; opacity: number };
  /** `clay.penguin_body` — material `penguin.body` in this theme (face, cheeks and eyes keep the GLB's colour — identity). */
  penguinBody: string;
  /** Evening: idle penguins sink into the dark by this much (0 = not at all). */
  idleDim: number;
}

const DAY_FURNITURE = '#F7F5F0';
const EVENING_BACKDROP = '#15161B';
const EVENING_LAMP = '#FFC56B';
const EVENING_SKY = '#3A4566';

export const DAY: OfficePalette = {
  backdrop: '#EEE9DF',
  materials: {
    'clay.wall': '#F4F1EA',
    'clay.floor': '#ECE7DE',
    'clay.furniture': DAY_FURNITURE,
    'clay.wood': '#D8C3A2',
    'clay.plant': '#8DB36B',
    'clay.screen': '#2C74E0',
    // an unlit bulb by day (README)
    'clay.lamp_bulb': '#FFF4DE',
  },
  screenGlow: null,
  lamp: null,
  agentLights: null,
  night: null,
  // README: sky #FFFFFF x0.72, sun #FFF6E8 x1.5 with a 14 deg angle — from the front left, above
  sky: { ambient: '#FFFFFF', ambientIntensity: 0.62, sun: '#FFF6E8', sunIntensity: 0.55, from: [-0.55, 1, 0.45], shadow: true },
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
    // README: a screen's base under its glow; an unlit bulb as dark as the room
    'clay.screen': '#1B2A4A',
    'clay.lamp_bulb': EVENING_BACKDROP,
  },
  screenGlow: '#8FB8FF',
  lamp: { bulb: '#FFC56B', pool: '#FFC56B', poolOpacity: 0.12 },
  agentLights: {
    lamp: { color: '#FFC56B', intensity: 1.6, distance: 2.2 },
    screen: { color: '#8FB8FF', intensity: 0.7, distance: 1.1 },
  },
  night: {
    fill: { sky: EVENING_LAMP, ground: EVENING_SKY, intensity: 0.75 },
    ceiling: { color: EVENING_LAMP, intensity: 14, distance: 14, height: 3.4 },
    board: { color: EVENING_LAMP, intensity: 2.4, distance: 2.6 },
    floorLamp: { color: EVENING_LAMP, intensity: 2.2, distance: 3 },
    poolOpacity: 0.08,
  },
  // README: sky #3A4566 x0.9 (weak), moon rim #9FB2E8 x2.5 from behind and above — it outlines
  // heads and shoulders, never faces; the room itself is lit by `night` below, the agents by their lamps and screens
  sky: { ambient: '#3A4566', ambientIntensity: 1.4, sun: '#9FB2E8', sunIntensity: 0.4, from: [-0.25, 0.9, -1], shadow: false },
  contact: { color: '#000000', opacity: 0.45 },
  // lighter than by day, so the silhouette holds in the navy room (DESIGN.md `clay.penguin_body`)
  penguinBody: '#474855',
  idleDim: 0,
};

export const paletteFor = (theme: Theme): OfficePalette => (theme === 'dark' ? EVENING : DAY);
