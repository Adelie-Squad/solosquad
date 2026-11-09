// @vitest-environment node
// DESIGN.md is the source of truth (`## 구현 매핑` — 동기화 검사): the colour table must match
// tokens.css value for value, and component CSS / TSX must not hold colours of their own.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAM_COLORS } from '../src/characters/colors';
import { DAY, EVENING } from '../src/office/palette';
import { CHROME } from '../src/theme';

const root = join(process.cwd(), '..');
const design = readFileSync(join(root, 'DESIGN.md'), 'utf8');
const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function section(title: string): string {
  const start = design.search(new RegExp(`^## ${title}$`, 'm'));
  expect(start, `DESIGN.md has no "## ${title}"`).toBeGreaterThan(-1);
  const rest = design.slice(start + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** `| `--bg` | `#EEE9DF` | `#15161B` | …` rows of the colour table. */
function colourTable(): { token: string; light: string; dark: string }[] {
  return section('색')
    .split('\n')
    .map((l) => l.match(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*`(#[0-9A-Fa-f]{6})`/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ token: m[1], light: m[2], dark: m[3] }));
}

/** Declarations inside a CSS block that starts at `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  expect(at, `tokens.css has no ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const body = css.slice(open + 1, end).replace(/[^{}]*\{/g, '');
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe('DESIGN.md `## 색` ↔ tokens.css', () => {
  const table = colourTable();
  const light = block(tokens, ':root {');
  const darkMedia = block(tokens, ':root:not([data-theme="light"])');
  const darkForced = block(tokens, ':root[data-theme="dark"]');

  it('reads the whole table', () => {
    expect(table.map((r) => r.token)).toEqual([
      '--bg', '--surface', '--surface-2', '--line', '--ink', '--ink-2', '--ink-3',
      '--accent', '--on-accent', '--ok', '--warn', '--danger', '--cheek', '--focus',
    ]);
  });

  it.each(table.map((r) => [r.token, r]))('%s matches in light, dark (system) and dark (chosen)', (_t, r) => {
    expect(light[r.token]?.toUpperCase()).toBe(r.light.toUpperCase());
    expect(darkMedia[r.token]?.toUpperCase()).toBe(r.dark.toUpperCase());
    expect(darkForced[r.token]?.toUpperCase()).toBe(r.dark.toUpperCase());
  });

  it('keeps the shadow rule: three steps in light, borders instead of shadows in dark', () => {
    const rows = section('간격·모서리·그림자')
      .split('\n')
      .map((l) => l.match(/^\|\s*`(--shadow-\d)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/))
      .filter((m): m is RegExpMatchArray => !!m);
    expect(rows).toHaveLength(3);
    const norm = (s: string) => s.replace(/\s+/g, '');
    for (const [, token, l, d] of rows) {
      expect(norm(light[token])).toBe(norm(l));
      expect(norm(darkMedia[token])).toBe(norm(d));
      expect(norm(darkForced[token])).toBe(norm(d));
    }
  });

  it('gives the browser chrome the --bg of each theme', () => {
    const bg = table.find((r) => r.token === '--bg')!;
    expect(CHROME.light.toUpperCase()).toBe(bg.light.toUpperCase());
    expect(CHROME.dark.toUpperCase()).toBe(bg.dark.toUpperCase());
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain(`content="${bg.light}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${bg.dark}" media="(prefers-color-scheme: dark)"`);
  });
});

describe('scene palette and team colours follow DESIGN.md', () => {
  const scene = section('사무실 장면');
  const row = (key: string) => scene.split('\n').find((l) => l.startsWith(`| \`${key}\``)) ?? '';
  const hexes = (s: string) => (s.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase());

  it('lists every clay key of the table in palette.ts', () => {
    const keys = scene
      .split('\n')
      .map((l) => l.match(/^\|\s*`(clay\.[a-z_]+)`/)?.[1])
      .filter(Boolean);
    expect(keys).toEqual(['clay.backdrop', 'clay.wall', 'clay.floor', 'clay.furniture', 'clay.wood', 'clay.plant', 'clay.screen', 'clay.lamp', 'clay.night', 'clay.sky', 'clay.penguin_body']);
    // the v2 keycap palette is gone with its code
    expect(scene).not.toMatch(/^\|\s*`(floor|ink|block|point)`/m);
  });

  it.each([
    ['clay.backdrop', [DAY.backdrop], [EVENING.backdrop]],
    ...(['clay.wall', 'clay.floor', 'clay.furniture', 'clay.wood', 'clay.plant'] as const).map(
      (k) => [k, [DAY.materials[k]], [EVENING.materials[k]]] as const,
    ),
    // day: the plain blue face; evening: the glow of a working screen
    ['clay.screen', [DAY.materials['clay.screen']], [EVENING.screenGlow!]],
    ['clay.lamp', [], [EVENING.lamp!.bulb]],
    ['clay.night', [], [EVENING.night!.pod.color, EVENING.night!.fill.ground]],
    ['clay.sky', [DAY.sky.ambient], [EVENING.sky.ambient]],
    ['clay.penguin_body', [DAY.penguinBody], [EVENING.penguinBody]],
  ] as const)('%s', (key, day, evening) => {
    expect(hexes(row(key))).toEqual([...day, ...evening].map((h) => h.toUpperCase()));
  });

  it('lamps, screen glow and the per-agent lights only in the evening', () => {
    expect(DAY.lamp).toBeNull();
    expect(DAY.screenGlow).toBeNull();
    expect(DAY.agentLights).toBeNull();
    expect(DAY.night).toBeNull();
    // the lights carry the table's lamp and screen colours
    expect(EVENING.agentLights?.lamp.color).toBe(EVENING.lamp?.bulb);
    expect(EVENING.agentLights?.screen.color).toBe(EVENING.screenGlow);
    expect(EVENING.lamp?.pool).toBe(EVENING.lamp?.bulb);
    // the room's night lights are the lamp's warm colour too (DESIGN `clay.night`)
    for (const l of [EVENING.night!.fill.sky, EVENING.night!.pod.color, EVENING.night!.board.color, EVENING.night!.floorLamp.color]) expect(l).toBe(EVENING.lamp?.bulb);
    expect(EVENING.night!.fill.ground).toBe(EVENING.sky.ambient);
  });

  it('the night-light table carries the palette values', () => {
    const n = EVENING.night!;
    const line = (start: string) => scene.split('\n').find((l) => l.trim().startsWith(`| ${start}`)) ?? '';
    expect(line('채움빛')).toContain(`| ${n.fill.intensity} |`);
    expect(line('무리 천장 빛')).toContain(`| ${n.pod.intensity} · 거리 ${n.pod.distance} |`);
    expect(line('무리 천장 빛')).toContain(`${n.pod.height}m`);
    expect(line('무리 천장 빛')).toContain(`불투명도 ${n.poolOpacity}`);
    expect(line('화이트보드 조명')).toContain(`| ${n.board.intensity} · 거리 ${n.board.distance} |`);
    expect(line('스탠드 두 개')).toContain(`| ${n.floorLamp.intensity} · 거리 ${n.floorLamp.distance} |`);
  });

  it('team colours', () => {
    const chars = section('에이전트 캐릭터');
    for (const [team, hex] of Object.entries(TEAM_COLORS)) {
      expect(chars, team).toMatch(new RegExp(`${team} · [^\`|]*\`${hex}\``, 'i'));
    }
  });
});

describe('no colour values outside the token files', () => {
  const src = join(process.cwd(), 'src');
  const allowed = new Set(['styles/tokens.css', 'office/palette.ts', 'characters/colors.ts', 'theme.ts']);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|tsx)$/.test(name) || (/\.ts$/.test(name) && p.includes(`${join('src', 'office')}`))) files.push(p);
    }
  };
  walk(src);
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black)\s*;|,\s*(white|black)\)/;

  it('finds the component files', () => expect(files.length).toBeGreaterThan(30));

  it.each(files.map((f) => [relative(src, f), f]))('%s', (name, file) => {
    if (allowed.has(name.split('\\').join('/'))) return;
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const hits = code.split('\n').filter((l) => COLOUR.test(l));
    expect(hits).toEqual([]);
  });
});

// DESIGN.md `## 색` (2026-11-08): a status colour mixed into a light background belongs to a chip,
// a step chip, a bar or a hover — never to a band, a callout, a table row or a selected card.
describe('no tinted bands', () => {
  const dir = join(process.cwd(), 'src', 'styles');
  const TINT = /background(?:-color)?\s*:\s*color-mix\(in srgb, var\(--(?:warn|danger|accent|ok)\) \d+%/;
  const CHIP_LIKE = /chip|step|vbar|pnl-bar|pnl-key|\.btn|wf-card-icon|work-artifact:hover|suggestion:hover/;
  const rules = readdirSync(dir).flatMap((f) =>
    [...readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      file: f,
      selector: m[1].trim().replace(/\s+/g, ' '),
      body: m[2],
    })),
  );

  it('reads the style sheets', () => expect(rules.length).toBeGreaterThan(300));

  it('tints only chips, step chips, bars and hovers', () => {
    const bands = rules.filter((r) => TINT.test(r.body) && !CHIP_LIKE.test(r.selector)).map((r) => `${r.file}: ${r.selector}`);
    expect(bands).toEqual([]);
  });

  it.each(['.approval-bar', '.viewer-banner', '.placeholder', '.home-bubble', '.statement tr.is-off th', '.wf-card.is-selected', '.command-bar li button.is-active'])('%s has no tinted background', (sel) => {
    const own = rules.filter((r) => r.selector.split(',').some((s) => s.trim() === sel));
    expect(own.length, sel).toBeGreaterThan(0);
    for (const r of own) expect(r.body, `${r.file}: ${r.selector}`).not.toMatch(TINT);
  });
});
