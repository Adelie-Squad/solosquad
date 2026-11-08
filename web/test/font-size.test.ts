// @vitest-environment node
// DESIGN.md `## 타이포그래피` — 최소 12px: no text on any screen (app or landing) renders under
// 12px, Korean or otherwise — monospace labels, chips, captions and small links included. Every
// `font-size` in the stylesheets is read: plain px, rem, the smallest end of clamp() / min() /
// max(), and custom properties it points at. `font-size: 0` (text hidden for an icon-only control)
// and `inherit` are the only exceptions. Inline `fontSize` in components is not allowed at all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIN = 12;
const web = process.cwd();
const styles = join(web, 'src/styles');
const sheets = readdirSync(styles)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: `src/styles/${f}`, css: readFileSync(join(styles, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

/** Every custom property declared anywhere (`--landing-mono: 12px`) — font sizes may go through one. */
const vars = new Map<string, string[]>();
for (const { css } of sheets) {
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) vars.set(m[1], [...(vars.get(m[1]) ?? []), m[2].trim()]);
}

/** The smallest px a font-size value can resolve to (Infinity when it has no length at all). */
function smallestPx(value: string, depth = 0): number {
  const v = value.trim();
  if (v === '0' || v === 'inherit' || v === 'initial' || v === 'unset') return Infinity;
  let low = Infinity;
  const fn = /^(clamp|max)\(([\s\S]*)\)$/.exec(v);
  if (fn) {
    // clamp(MIN, …, …) and max(a, b): the floor is the first argument / the largest argument —
    // either way it is enough that the first argument is ≥ 12px
    return smallestPx(splitArgs(fn[2])[0], depth + 1);
  }
  for (const m of v.matchAll(/var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)/g)) {
    for (const def of vars.get(m[1]) ?? []) low = Math.min(low, depth > 4 ? Infinity : smallestPx(def, depth + 1));
    if (m[2]) low = Math.min(low, smallestPx(m[2], depth + 1));
  }
  const bare = v.replace(/var\([^)]*\)/g, '');
  for (const m of bare.matchAll(/(-?\d*\.?\d+)(px|rem|em|%)?/g)) {
    const n = Number(m[1]);
    if (m[2] === 'px') low = Math.min(low, n);
    else if (m[2] === 'rem') low = Math.min(low, n * 16);
    else if (m[2] === 'em' || m[2] === '%') low = Math.min(low, m[2] === '%' ? n / 100 * 16 : n * 16);
  }
  if (/\b(smaller|x-small|xx-small|small)\b/.test(v)) low = Math.min(low, 0);
  return low;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim());
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });
}

describe('최소 12px (DESIGN.md `## 타이포그래피`)', () => {
  it('reads values the way the rule means them', () => {
    expect(smallestPx('11.5px')).toBe(11.5);
    expect(smallestPx('clamp(36px, 4.4vw, 56px)')).toBe(36);
    expect(smallestPx('clamp(10px, 2vw, 14px)')).toBe(10);
    expect(smallestPx('0.7rem')).toBeCloseTo(11.2);
    expect(smallestPx('0')).toBe(Infinity);
    expect(smallestPx('var(--landing-mono)')).toBeGreaterThanOrEqual(MIN);
    expect(smallestPx('smaller')).toBe(0);
  });

  it('no font-size in any stylesheet is under 12px', () => {
    const bad: string[] = [];
    for (const { file, css } of sheets) {
      for (const m of css.matchAll(/font-size\s*:\s*([^;{}]+);/g)) {
        const px = smallestPx(m[1]);
        if (px < MIN) {
          const line = css.slice(0, m.index).split('\n').length;
          bad.push(`${file}:${line} font-size: ${m[1].trim()} (${px}px)`);
        }
      }
      // the `font:` shorthand must not carry a size under the floor either
      for (const m of css.matchAll(/(?:^|[;{\s])font\s*:\s*([^;{}]+);/g)) {
        const size = /(\d*\.?\d+)px/.exec(m[1]);
        if (size && Number(size[1]) < MIN) bad.push(`${file} font: ${m[1].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('font-size custom properties hold 12px or more', () => {
    const bad = [...vars].filter(([name]) => /font|fs|mono|text-size/.test(name)).flatMap(([name, defs]) => defs.filter((d) => smallestPx(d) < MIN).map((d) => `${name}: ${d}`));
    expect(bad).toEqual([]);
  });

  it('components set no inline font size', () => {
    const bad = sources(join(web, 'src'))
      .filter((p) => /fontSize\s*:|font-size\s*:/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(web, p));
    expect(bad).toEqual([]);
  });

  it('DESIGN.md states the floor', () => {
    const design = readFileSync(join(web, '..', 'DESIGN.md'), 'utf8');
    expect(design.includes('최소 12px')).toBe(true);
    expect(design.includes('UI 글자 11px')).toBe(false);
  });
});
