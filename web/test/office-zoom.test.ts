// DESIGN.md `## 사무실 장면` — 확대 · 축소 (2026-11-09, evened out 2026-11-10): five levels at
// one constant ratio from the whole office to one desk, the controller that steps, clamps, pans
// (a rubber band at the edges and at L1) and focuses, the wheel rule (every wheel over the scene
// zooms — a notch is a level, a trackpad gesture adds up to one), the name-tag rule per level and
// the collision that hides a tag rather than shrinking it, and the saved level + centre.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROSTER } from '../src/characters/roster';
import { layoutOffice, roomFor, type SeatAgent } from '../src/office/layout';
import { tagShown } from '../src/office/OfficeStage';
import {
  collidingTags,
  floorPoint,
  LEVELS,
  loadZoom,
  nearestLevel,
  officeFrame,
  project,
  RUBBER,
  SMOOTH_STEP_PX,
  tagPriority,
  tagsShowAll,
  teamLevel,
  viewRect,
  wheelFactor,
  wheelKind,
  WheelStepper,
  ZoomController,
  ZOOM_MS,
} from '../src/office/zoom';

const bundled: SeatAgent[] = Object.entries(ROSTER).map(([name, look]) => ({ name, team: name === 'chief' ? 'core' : look.team }));
const small: SeatAgent[] = [
  { name: 'chief', team: 'core' },
  { name: 'a', team: 'brand' },
  { name: 'b', team: 'brand' },
  ...Array.from({ length: 8 }, (_, i) => ({ name: `e${i}`, team: 'engineering' })),
];

function frameFor(agents: SeatAgent[], width = 1200, height = 760) {
  const pods = layoutOffice(agents, { aspect: width / height });
  return { pods, room: roomFor(pods), frame: officeFrame(pods, roomFor(pods), width, height) };
}

describe('view coordinates', () => {
  it('projects along the 30° / 45° view and finds the floor back', () => {
    // the camera looks along −VIEW, so two points on one VIEW line project the same
    const a = project(1, 0, 2);
    const b = project(1 + 0.6124 * 3, 0.5 * 3, 2 + 0.6124 * 3);
    expect(a.u).toBeCloseTo(b.u, 3);
    expect(a.v).toBeCloseTo(b.v, 3);
    const p = floorPoint(a.u, a.v);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.z).toBeCloseTo(2, 6);
  });

  it('frames a box by its corners', () => {
    const r = viewRect(-1, 1, 0, 1, -1, 1);
    expect(r.u1 - r.u0).toBeCloseTo(2 * Math.SQRT2, 6);
    expect(r.v1).toBeGreaterThan(r.v0);
  });
});

describe('five evenly spaced levels', () => {
  it.each([
    ['the bundled office', bundled, 1200, 760],
    ['a 2-person and an 8-person team', small, 1200, 760],
    ['Chief alone', [{ name: 'chief', team: 'core' }], 1200, 760],
    ['the bundled office on a tall stage', bundled, 600, 900],
    ['the bundled office in a full-screen pop-out', bundled, 1900, 1040],
  ])('%s: L1 = the whole room, one constant ratio between neighbours', (_, agents, w, h) => {
    const { frame } = frameFor(agents as SeatAgent[], w as number, h as number);
    expect(frame.levels).toHaveLength(LEVELS);
    expect(frame.levels[0]).toBe(1);
    const ratios = frame.levels.slice(1).map((l, i) => l / frame.levels[i]);
    for (const r of ratios) {
      expect(r).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(r / ratios[0]).toBeCloseTo(1, 6); // even, within 1e-6
    }
  });

  it('L5 frames one desk; a team label frames its whole pod at the deepest level that can', () => {
    const { frame, pods } = frameFor(small);
    const deskRect = viewRect(-0.48, 0.48, 0, 1.6, -0.5, 0.5);
    const visW = frame.fit.w / frame.levels[4];
    const visH = frame.fit.h / frame.levels[4];
    // the desk fits at L5, and fills most of one side of the view
    expect(deskRect.u1 - deskRect.u0).toBeLessThanOrEqual(visW);
    expect(deskRect.v1 - deskRect.v0).toBeLessThanOrEqual(visH);
    expect(Math.max((deskRect.u1 - deskRect.u0) / visW, (deskRect.v1 - deskRect.v0) / visH)).toBeGreaterThan(0.6);
    const big = pods.find((p) => p.key === 'engineering')!;
    const pair = pods.find((p) => p.key === 'brand')!;
    const fits = (p: typeof big, zoom: number) => {
      const r = viewRect(p.x - p.w / 2, p.x + p.w / 2, 0, 1.8, p.z - p.d / 2, p.z + p.d / 2);
      // with the 0.3 m margin a team framing keeps around its pod
      return r.u1 - r.u0 + 0.6 <= (frame.fit.w / zoom) * 1.02 + 1e-6 && r.v1 - r.v0 + 0.6 <= (frame.fit.h / zoom) * 1.02 + 1e-6;
    };
    for (const p of [big, pair]) {
      const lv = frame.teams[p.key].level;
      expect(fits(p, frame.levels[lv - 1])).toBe(true);
      if (lv < LEVELS) expect(fits(p, frame.levels[lv])).toBe(false);
    }
    // the bigger team needs to stand further back
    expect(frame.teams.engineering.level).toBeLessThan(frame.teams.brand.level);
    expect(frame.teams.chief).toBeUndefined();
    // never the whole room for a team
    expect(teamLevel(frame.levels, 0.5)).toBe(2);
  });

  it('knows every desk, and the nearest level of any zoom', () => {
    const { frame } = frameFor(bundled);
    for (const a of bundled) expect(frame.agents[a.name]).toBeDefined();
    expect(nearestLevel(frame.levels, 1)).toBe(1);
    expect(nearestLevel(frame.levels, frame.levels[4] * 2)).toBe(5);
    expect(nearestLevel(frame.levels, frame.levels[2] * 1.01)).toBe(3);
  });
});

describe('the controller', () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    now = 0;
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  const make = (key?: string) => {
    const z = new ZoomController(key, clock);
    z.reduced = true; // instant — the tween is tested on its own
    z.setFrame(frameFor(bundled).frame);
    return z;
  };

  it('steps one level at a time and stops at 1 and 5', () => {
    const z = make();
    expect(z.level()).toBe(1);
    z.stepOut();
    expect(z.level()).toBe(1);
    for (let i = 2; i <= 5; i++) {
      z.stepIn();
      expect(z.level()).toBe(i);
      expect(z.view.zoom).toBeCloseTo(z.frame!.levels[i - 1], 6);
    }
    z.stepIn();
    expect(z.level()).toBe(5);
    z.stepOut();
    expect(z.level()).toBe(4);
  });

  it('the hidden `0` key (fit) resets to L1, centred', () => {
    const z = make();
    z.focusAgent('researcher');
    expect(z.level()).toBe(5);
    z.fit();
    expect(z.level()).toBe(1);
    expect(z.view.u).toBeCloseTo(z.frame!.fit.u, 6);
    expect(z.view.v).toBeCloseTo(z.frame!.fit.v, 6);
  });

  it('focuses an agent at L5 and a team at its level, centred on it', () => {
    const z = make();
    expect(z.focusAgent('backend-engineer')).toBe(true);
    expect(z.level()).toBe(5);
    const at = z.frame!.agents['backend-engineer'];
    expect(z.view.u).toBeCloseTo(at.u, 3);
    expect(z.view.v).toBeCloseTo(at.v, 3);
    expect(z.focusAgent('nobody')).toBe(false);
    const key = Object.keys(z.frame!.teams)[0];
    z.focusTeam(key);
    expect(z.level()).toBe(z.frame!.teams[key].level);
  });

  it('a drag pans at every zoomed level, 1:1 with the pointer inside the bounds', () => {
    const z = make();
    const f = z.frame!;
    for (const lv of [2, 3, 4, 5]) {
      z.setLevel(lv, f.fit);
      const a = { ...z.view };
      z.dragBy(-20, 10);
      z.endDrag();
      // 20 px of the stage = 20 / width of the view
      expect(z.view.u - a.u).toBeCloseTo((20 / f.width) * (f.fit.w / a.zoom), 6);
      expect(z.view.v - a.v).toBeCloseTo((10 / f.height) * (f.fit.h / a.zoom), 6);
    }
  });

  it('at L1 (and past the edges) a drag pulls with resistance and springs back on release', () => {
    const z = make();
    const f = z.frame!;
    z.dragBy(300, 0);
    const pulled = f.fit.u - z.view.u;
    expect(pulled).toBeGreaterThan(0); // it answers
    expect(pulled).toBeLessThan((300 / f.width) * f.fit.w * 0.5); // with resistance
    for (let i = 0; i < 40; i++) z.dragBy(300, 0);
    expect(f.fit.u - z.view.u).toBeLessThanOrEqual(f.fit.w * RUBBER + 1e-9); // never more than the band
    z.endDrag();
    expect(z.view.u).toBeCloseTo(f.fit.u, 6);
    expect(z.view.v).toBeCloseTo(f.fit.v, 6);
  });

  it('a wheel notch steps one level towards the pointer, counting from a running tween', () => {
    const z = make();
    const f = z.frame!;
    const px = f.width * 0.25;
    const py = f.height * 0.6;
    const under = (v: typeof z.view) => ({ u: v.u + ((px / f.width - 0.5) * f.fit.w) / v.zoom, v: v.v + ((0.5 - py / f.height) * f.fit.h) / v.zoom });
    z.setLevel(2);
    const a = under(z.view);
    z.stepAt(1, px, py);
    expect(z.level()).toBe(3);
    const b = under(z.view);
    expect(b.u).toBeCloseTo(a.u, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
    z.stepAt(-1, px, py);
    z.stepAt(-1, px, py);
    expect(z.level()).toBe(1);
    // eased: three quick notches go three levels
    const e = new ZoomController(undefined, clock);
    e.setFrame(frameFor(bundled).frame);
    e.stepAt(1, px, py);
    e.stepAt(1, px, py);
    e.stepAt(1, px, py);
    now = ZOOM_MS + 1;
    e.tick();
    expect(e.level()).toBe(4);
  });

  it('pans inside the room (plus a margin); the arrow keys do nothing at L1', () => {
    const z = make();
    const before = { ...z.view };
    z.panBy(500, 300);
    expect(z.view).toEqual(before);
    z.setLevel(5);
    for (let i = 0; i < 50; i++) z.panBy(400, 0);
    const f = z.frame!;
    const halfW = f.fit.w / z.view.zoom / 2;
    expect(z.view.u - halfW).toBeGreaterThanOrEqual(f.bounds.u0 - f.fit.w * 0.04 - 1e-6);
  });

  it('zooms toward the pointer: the point under it stays put', () => {
    const z = make();
    const f = z.frame!;
    const px = f.width * 0.8;
    const py = f.height * 0.3;
    const under = (v: typeof z.view) => ({ u: v.u + ((px / f.width - 0.5) * f.fit.w) / v.zoom, v: v.v + ((0.5 - py / f.height) * f.fit.h) / v.zoom });
    z.zoomAt(1.5, px, py);
    const a = under(z.view);
    z.zoomAt(1.5, px, py);
    const b = under(z.view);
    expect(b.u).toBeCloseTo(a.u, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
    z.zoomAt(1000, px, py);
    expect(z.view.zoom).toBeCloseTo(f.levels[4], 6);
    z.zoomAt(0.0001, px, py);
    expect(z.view.zoom).toBeCloseTo(1, 6);
  });

  it('eases between levels over ~360 ms, instantly with reduced motion', () => {
    const z = new ZoomController(undefined, clock);
    z.setFrame(frameFor(bundled).frame);
    z.setLevel(3);
    expect(z.view.zoom).toBe(1);
    now = ZOOM_MS / 2;
    z.tick();
    expect(z.view.zoom).toBeGreaterThan(1);
    expect(z.view.zoom).toBeLessThan(z.frame!.levels[2]);
    now = ZOOM_MS + 1;
    z.tick();
    expect(z.view.zoom).toBeCloseTo(z.frame!.levels[2], 6);
    z.reduced = true;
    z.setLevel(5);
    expect(z.view.zoom).toBeCloseTo(z.frame!.levels[4], 6);
  });

  it('remembers the level and the centre per key, and restores them', () => {
    const key = 'solosquad.office.zoom.acme/main';
    const a = make(key);
    a.focusAgent('marketer');
    expect(loadZoom(key)).toMatchObject({ level: 5 });
    const b = make(key);
    expect(b.level()).toBe(5);
    expect(b.view.u).toBeCloseTo(a.view.u, 2);
    expect(b.view.v).toBeCloseTo(a.view.v, 2);
    // another key (the pop-out) keeps its own
    const c = make('solosquad.office.display-zoom.acme/main');
    expect(c.level()).toBe(1);
    localStorage.setItem(key, '{not json');
    expect(make(key).level()).toBe(1);
  });
});

describe('wheel rule — every wheel over the scene zooms', () => {
  const ev = (deltaY: number, more: Partial<{ deltaMode: number; ctrlKey: boolean; wheelDeltaY: number }> = {}) => ({ deltaY, deltaMode: 0, ctrlKey: false, ...more });

  it('tells a mouse notch from a trackpad scroll and a pinch', () => {
    // macOS Chrome / Safari: a notch is a multiple of 4.000244 px — often just one
    expect(wheelKind(ev(-4.000244140625), 16)).toBe('notch');
    expect(wheelKind(ev(12.000732421875), 16)).toBe('notch');
    // Firefox: lines; Windows: a lone 100 px with wheelDelta 120
    expect(wheelKind(ev(3, { deltaMode: 1 }), 16)).toBe('notch');
    expect(wheelKind(ev(100, { wheelDeltaY: -120 }))).toBe('notch');
    // a trackpad: small, frequent deltas; with ctrl it is a pinch
    expect(wheelKind(ev(-7.5), 16)).toBe('smooth');
    expect(wheelKind(ev(-60), 16)).toBe('smooth');
    expect(wheelKind(ev(-2.3, { ctrlKey: true }), 16)).toBe('pinch');
    // ctrl + a mouse notch is still a notch
    expect(wheelKind(ev(-4.000244140625, { ctrlKey: true }), 200)).toBe('notch');
  });

  it('one notch = one level, in either direction', () => {
    const s = new WheelStepper();
    expect(s.push(ev(-4.000244140625), 'notch', 0)).toBe(1);
    expect(s.push(ev(-4.000244140625), 'notch', 40)).toBe(1);
    expect(s.push(ev(100), 'notch', 400)).toBe(-1);
  });

  it('a trackpad scroll adds up to one level, and one flick (with its glide) stays one level', () => {
    const s = new WheelStepper();
    let t = 0;
    const steps: number[] = [];
    // a flick: rising for 5 events, then gliding for ~1 s — ~900 px in all
    for (let i = 0; i < 60; i++) {
      const d = i < 5 ? 60 * ((i + 1) / 5) : 60 * 0.93 ** (i - 5);
      const r = s.push(ev(-Math.max(0.5, d)), 'smooth', (t += 16));
      if (r) steps.push(r);
    }
    expect(steps).toEqual([1]);
    // a slow push under the threshold does nothing yet
    const slow = new WheelStepper();
    let n = 0;
    for (let px = 0; px < SMOOTH_STEP_PX - 10; px += 5) n += Math.abs(slow.push(ev(-5), 'smooth', (t += 16)));
    expect(n).toBe(0);
    // a pause, then another flick: a second level
    t += 400;
    for (let i = 0; i < 20; i++) {
      const r = s.push(ev(-40), 'smooth', (t += 16));
      if (r) steps.push(r);
    }
    expect(steps).toEqual([1, 1]);
    // the other way at once
    expect([...Array(10)].map(() => s.push(ev(30), 'smooth', (t += 16))).filter(Boolean)).toEqual([-1]);
  });

  it('a pinch follows the fingers (wheel up zooms in, down out)', () => {
    expect(wheelFactor({ deltaY: -10, deltaMode: 0 })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 5, deltaMode: 0 })).toBeLessThan(1);
    expect(new WheelStepper().push(ev(-3, { ctrlKey: true }), 'pinch', 0)).toBe(0);
  });
});

describe('name tags per level', () => {
  it('from L3 every tag shows; at L1–L2 an idle one only when pointed at', () => {
    expect(tagsShowAll(1)).toBe(false);
    expect(tagsShowAll(2)).toBe(false);
    for (const l of [3, 4, 5]) expect(tagsShowAll(l)).toBe(true);
    expect(tagShown('idle', 1, false)).toBe(false);
    expect(tagShown('idle', 2, true)).toBe(true);
    expect(tagShown('typing', 1, false)).toBe(true);
    expect(tagShown('waiting', 2, false)).toBe(true);
    for (const l of [3, 4, 5]) expect(tagShown('idle', l, false)).toBe(true);
  });

  it('hides the less urgent of two overlapping tags instead of shrinking it', () => {
    const at = (name: string, x: number, prio: number) => ({ name, x, y: 100, w: 120, h: 26, prio });
    const hidden = collidingTags([at('idle', 100, tagPriority('idle', false)), at('wait', 150, tagPriority('waiting', false)), at('far', 400, tagPriority('done', false))]);
    expect([...hidden]).toEqual(['idle']);
    expect(tagPriority('idle', true)).toBeLessThan(tagPriority('waiting', false));
    expect(tagPriority('error', false)).toBeLessThan(tagPriority('typing', false));
  });
});
