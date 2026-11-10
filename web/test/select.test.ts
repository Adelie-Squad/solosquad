// @vitest-environment node
// The dropdown component (DESIGN.md `## 컴포넌트` 드롭다운, user 2026-11-11 — "드롭다운 버튼에 아래
// 화살표 오른쪽 패딩이 너무 좁은데 컴포넌트 수정해줘"). Every native <select> gets one style from
// design.css: no browser arrow, our chevron 12px from the right, 36px right padding, the button
// height. This static check fails if a select is left to the browser or styled on its own.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(SRC);
const css = files.filter((f) => f.endsWith('.css'));
const tsx = files.filter((f) => f.endsWith('.tsx'));

/** [selector, body] of every plain rule (nested @media bodies included, comments dropped). */
function rules(text: string): [string, string][] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: [string, string][] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) out.push([m[1].trim(), m[2]]);
  return out;
}

const SELECTS_SELECT = /(^|[\s,>+~(])select(?![-\w])/;
const BOX = /(^|;)\s*(padding[\w-]*|background[\w-]*|appearance|-webkit-appearance|height|min-height|border(-radius)?)\s*:/;

describe('the dropdown component', () => {
  const design = readFileSync(join(SRC, 'styles', 'design.css'), 'utf8');
  const base = rules(design).find(([sel]) => sel === 'select')?.[1] ?? '';

  it('hides the browser arrow and draws the chevron with room on the right', () => {
    expect(base).toMatch(/appearance:\s*none/);
    expect(base).toMatch(/-webkit-appearance:\s*none/);
    expect(base).toMatch(/var\(--select-chevron\)[^;]*right 12px center/);
    const right = Number(base.match(/padding:\s*0\s+(\d+)px\s+0\s+\d+px/)?.[1]);
    expect(right).toBeGreaterThanOrEqual(32); // ≥ 32–36px: the value never runs under the chevron
    expect(base).toMatch(/height:\s*36px/); // the button height
    const small = rules(design).find(([sel]) => sel === 'select.is-small')?.[1] ?? '';
    expect(small).toMatch(/height:\s*32px/);
    expect(rules(design).some(([sel, body]) => sel === 'select:disabled' && /opacity/.test(body))).toBe(true);
  });

  it('has a chevron colour for light and for dark', () => {
    const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
    expect(tokens.match(/--select-chevron:/g)).toHaveLength(3); // :root · dark (system) · dark (chosen)
    expect(tokens).toMatch(/m6 9 6 6 6-6/); // Lucide ChevronDown
  });

  it('no other stylesheet gives a select its own box (padding · background · height · border)', () => {
    const hits: string[] = [];
    for (const f of css) {
      for (const [sel, body] of rules(readFileSync(f, 'utf8'))) {
        if (!SELECTS_SELECT.test(sel)) continue;
        const ours = f.endsWith(join('styles', 'design.css')) && /^select([.:][\w-]+(\([^)]*\))?)*( option)?$/.test(sel);
        if (!ours && BOX.test(body.replace(/\n/g, ';'))) hits.push(`${f.replace(SRC, 'src')}: ${sel}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('every <select> in the app is a plain native select (no inline style, no size/multiple list box)', () => {
    const hits: string[] = [];
    let count = 0;
    for (const f of tsx) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/<select\b([^>]*)>/g)) {
        count += 1;
        if (/\bstyle=|\bsize=|\bmultiple\b/.test(m[1])) hits.push(`${f.replace(SRC, 'src')}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(count).toBeGreaterThan(10); // language · filters · calendar labels · landing language …
    expect(hits).toEqual([]);
  });
});
