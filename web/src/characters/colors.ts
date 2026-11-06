// Character colours (DESIGN.md `## 에이전트 캐릭터` · guide §3 penguin palette). With
// office/palette.ts this is the only TS file allowed to hold colour values — the design
// sync test reads TEAM_COLORS against the table in DESIGN.md.

/** Team → its colour (laptop sticker in the office, prop accents, icon ring). */
export const TEAM_COLORS: Record<string, string> = {
  core: '#C9A227',
  product: '#2C74E0',
  engineering: '#9AC22D',
  business: '#9B6A3C',
  brand: '#E01FAE',
};

/** A team the table does not know (a customer's own) — neutral ink-3. */
export const TEAM_FALLBACK = '#8A8371';

export const PENGUIN_2D = {
  body: '#2B2A26',
  bodyTop: '#3D3B35',
  face: '#F3F0EA',
  faceShade: '#C9BD98',
  eye: '#151410',
  beak: '#F0AE5E',
  line: '#111008',
  stitch: '#8E8676',
  // props
  gold: '#C9A227',
  paper: '#F4F1EA',
  metal: '#8A8371',
  lens: '#C9DDF6',
  red: '#C2362B',
  helmet: '#F0C640',
};

export const teamColor = (team: string | null | undefined): string =>
  (team && TEAM_COLORS[team]) || TEAM_FALLBACK;
