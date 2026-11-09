// The 2D penguin (DESIGN.md `## 에이전트 캐릭터`, 2026-11-10 redesign): round eyes larger than the
// round cheeks, a white diamond beak sewn in black, black stitch, black feet — and the sizes
// DESIGN.md gives as ratios of the face match the drawing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PENGUIN_2D } from '../src/characters/colors';
import { AgentIcon, Mascot, Penguin, stitchStyle } from '../src/characters/PenguinIcon';
import { BEAK, CHEEKS, EYES, FACE_WIDTH_AT_EYES } from '../src/characters/penguinShape';

afterEach(cleanup);

const parts = (root: Element, part: string) => [...root.querySelectorAll(`[data-part="${part}"]`)];

describe('the 2D penguin', () => {
  it('draws eyes and cheeks as circles, the eyes larger than the cheeks', () => {
    for (const size of [20, 28, 40, 96]) {
      const { container } = render(<Penguin size={size} team="product" />);
      const eyes = parts(container, 'eye');
      const cheeks = parts(container, 'cheek');
      expect(eyes).toHaveLength(2);
      expect(cheeks).toHaveLength(2);
      for (const el of [...eyes, ...cheeks]) expect(el.tagName.toLowerCase()).toBe('circle');
      const r = (el: Element) => Number(el.getAttribute('r'));
      expect(Math.min(...eyes.map(r))).toBeGreaterThan(Math.max(...cheeks.map(r)));
      cleanup();
    }
    expect(Math.min(...EYES.map((e) => e.r))).toBeGreaterThan(Math.max(...CHEEKS.map((c) => c.r)));
  });

  it('has a white diamond beak with a black stitch, a black front stitch and black feet', () => {
    expect(PENGUIN_2D.stitch).toBe(PENGUIN_2D.eye);
    expect(PENGUIN_2D.feet).toBe(PENGUIN_2D.eye);
    expect(PENGUIN_2D.beak).toMatch(/^#F[0-9A-F]F[0-9A-F]F[0-9A-F]$/i); // a white
    const { container } = render(<Mascot size={96} />);
    const beak = parts(container, 'beak')[0];
    expect(beak.getAttribute('fill')).toBe(PENGUIN_2D.beak);
    // four corners: top, right, bottom, left — a diamond, the lower half a little longer
    const pts = beak.getAttribute('d')!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const want = [BEAK.cx, BEAK.cy - BEAK.up, BEAK.cx + BEAK.halfWidth, BEAK.cy, BEAK.cx, BEAK.cy + BEAK.down, BEAK.cx - BEAK.halfWidth, BEAK.cy];
    expect(pts).toHaveLength(want.length);
    want.forEach((v, i) => expect(pts[i]).toBeCloseTo(v, 2));
    expect(parts(container, 'beak-stitch')[0].getAttribute('stroke')).toBe(PENGUIN_2D.stitch);
    expect(parts(container, 'stitch')[0].getAttribute('stroke')).toBe(PENGUIN_2D.stitch);
    const feet = parts(container, 'foot');
    expect(feet).toHaveLength(2);
    for (const f of feet) expect(f.getAttribute('fill')).toBe(PENGUIN_2D.feet);
  });

  it('dashes the stitch from 40px and draws it as one thin line below', () => {
    expect(stitchStyle(20).dash).toBeUndefined();
    expect(stitchStyle(28).dash).toBeUndefined();
    expect(stitchStyle(40).dash).toBeTruthy();
    expect(stitchStyle(96).beakDash).toBeTruthy();
    const { container } = render(<AgentIcon agent="researcher" size={20} />);
    expect(parts(container, 'stitch')[0].getAttribute('stroke-dasharray')).toBeNull();
    // the icon is cut at the chest: no feet in the ring
    expect(parts(container, 'foot')).toHaveLength(0);
  });

  it('matches the ratios DESIGN.md gives (of the face width at the eyes)', () => {
    const design = readFileSync(join(process.cwd(), '..', 'DESIGN.md'), 'utf8');
    const at = design.search(/^## 에이전트 캐릭터$/m);
    const section = design.slice(at, design.indexOf('\n## ', at + 3));
    const ratio = (label: string) => {
      const m = section.match(new RegExp(`${label}\\s*(?:=\\s*)?(0\\.\\d+)`));
      expect(m, `DESIGN.md ## 에이전트 캐릭터 has no "${label} 0.xx"`).toBeTruthy();
      return Number(m![1]);
    };
    const w = FACE_WIDTH_AT_EYES;
    expect(ratio('눈 지름')).toBeCloseTo((2 * EYES[0].r) / w, 2);
    expect(ratio('볼 지름')).toBeCloseTo((2 * CHEEKS[0].r) / w, 2);
    expect(ratio('부리 폭')).toBeCloseTo((2 * BEAK.halfWidth) / w, 2);
    expect(ratio('부리 높이')).toBeCloseTo((BEAK.up + BEAK.down) / w, 2);
  });
});
