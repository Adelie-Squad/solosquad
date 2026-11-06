// @vitest-environment node
// DESIGN.md `## 아이콘`: UI symbols are Lucide icons — never emoji or text glyphs standing in
// for icons. Conversation text (what people and agents write) is data from the engine, not
// source, so it is not scanned and may hold any emoji.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON, ICON_DEFAULTS } from '../src/icons';

const root = join(process.cwd(), '..');
const design = readFileSync(join(root, 'DESIGN.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dependencies: Record<string, string> };

function section(title: string): string {
  const start = design.search(new RegExp(`^## ${title}$`, 'm'));
  expect(start, `DESIGN.md has no "## ${title}"`).toBeGreaterThan(-1);
  const rest = design.slice(start + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

const src = join(process.cwd(), 'src');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.gen.ts')) files.push(p);
  }
};
walk(src);

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** Emoji, and the text glyphs that used to stand in for icons (check, cross, caret, play, menu…). */
const EMOJI = /\p{Extended_Pictographic}|️/u;
const GLYPH = /[✓✔✕✖✗☰⎋⛶▾▴▸▶◀○●←→]/;

describe('no emoji in the UI (DESIGN.md `## 아이콘`)', () => {
  it('finds the source files', () => expect(files.length).toBeGreaterThan(40));

  it.each(files.map((f) => [relative(src, f), f]))('%s', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    const hits = code.split('\n').filter((l) => EMOJI.test(l) || GLYPH.test(l));
    expect(hits).toEqual([]);
  });
});

describe('the icon table follows DESIGN.md', () => {
  const rows = section('아이콘')
    .split('\n')
    .map((l) => l.match(/^\|[^|]+\|\s*`([a-zA-Z]+)`\s*\|\s*`([A-Za-z0-9]+)`\s*\|/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ key: m[1], name: m[2] }));

  it('lists every key of icons.ts and nothing else', () => {
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(ICON).sort());
  });

  it.each(rows.map((r) => [r.key, r.name]))('%s → %s', (key, name) => {
    const icon = ICON[key as keyof typeof ICON] as unknown as { displayName?: string };
    expect(icon.displayName).toBe(name);
  });

  it('names the pinned Lucide version and the defaults', () => {
    const version = pkg.dependencies['lucide-react'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/); // pinned, no range
    expect(section('아이콘')).toContain(`lucide-react@${version}`);
    expect(section('아이콘')).toContain(`${ICON_DEFAULTS.strokeWidth}`);
  });
});
