// The zoom on the page (DESIGN.md `## 사무실 장면` — 확대 · 축소): the corner control is − · +
// only (no level dots, no 전체 보기 — user 2026-11-10) and clamps, the keys work while the scene
// has focus (`0` stays as a hidden shortcut), every wheel over the scene zooms — on the office
// page too, and in full screen — while a wheel outside it is left to the page, a drag pans (at
// L1 it springs back) and is never a click, a double-click on a penguin zooms to it (a single
// click still opens the modal), name tags all show from L3, the level is announced and
// remembered, and the WebGL-off list has no zoom.
// The 3D chunk is replaced by a stub that hands the controller a real frame from the layout.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seatClicks } from '../src/office/clicks';
import { layoutOffice, roomFor, type SeatAgent } from '../src/office/layout';
import type { OfficeCanvasProps } from '../src/office/OfficeCanvas';
import { OfficeStage, zoomKey } from '../src/office/OfficeStage';
import { loadZoom, officeFrame, type ZoomController } from '../src/office/zoom';
import { renderWith } from './helpers';

const seats: SeatAgent[] = [
  { name: 'chief', team: 'core', label: 'Chief' },
  { name: 'a', team: 'brand', label: 'Ann' },
  { name: 'b', team: 'brand', label: 'Ben' },
  ...Array.from({ length: 8 }, (_, i) => ({ name: `e${i}`, team: 'engineering', label: `Eng ${i}` })),
];

let lastZoom: ZoomController | null = null;
vi.mock('../src/office/OfficeCanvas', () => ({
  default: function StubCanvas(props: OfficeCanvasProps) {
    useEffect(() => {
      const pods = layoutOffice(props.agents, { aspect: 1200 / 760 });
      props.zoom.reduced = true;
      props.zoom.setFrame(officeFrame(pods, roomFor(pods), 1200, 760));
      lastZoom = props.zoom;
      props.onPods(pods.map((p) => ({ key: p.key, team: p.team, chief: p.desks.some((d) => d.chief) })));
      props.onReady();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // a click on the canvas is a click on penguin `a` (the real one raycasts)
    return <div data-testid="canvas" onClick={() => props.onSelect('a')} />;
  },
}));

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  localStorage.clear();
  lastZoom = null;
  // jsdom has no WebGL: pretend there is one so the stage takes the 3D path
  (globalThis as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext = function () {};
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as typeof realGetContext;
  window.history.replaceState(null, '', '/');
  // reduced motion: level changes land at once (there is no frame loop here to run the tween)
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = realGetContext;
  delete (globalThis as unknown as { WebGLRenderingContext?: unknown }).WebGLRenderingContext;
  vi.useRealTimers();
});

const KEY = zoomKey('tesla', 'charging');

async function mount(over: Partial<Parameters<typeof OfficeStage>[0]> = {}) {
  const onSelect = vi.fn();
  const view = renderWith(
    <OfficeStage agents={seats} statuses={{}} theme="light" onSelect={onSelect} fallback={<p>list</p>} storageKey={KEY} {...over} />,
    'ko',
  );
  await screen.findByTestId('canvas');
  await screen.findByRole('toolbar');
  current = lastZoom;
  return { ...view, onSelect, zoom: lastZoom! };
}

let current: ZoomController | null = null;
const pressed = () => current!.level();
const goLevel = (n: number) => act(() => current!.setLevel(n));

describe('zoom control', () => {
  it('is − · + only: no level dots, no 전체 보기', async () => {
    await mount();
    const bar = screen.getByRole('toolbar');
    expect([...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['축소', '확대']);
    expect(screen.queryByRole('button', { name: '전체 보기' })).toBeNull();
    expect(screen.queryByRole('button', { name: /확대 수준/ })).toBeNull();
    expect(document.querySelector('.office-zoom-dot, .office-zoom-dots')).toBeNull();
  });

  it('steps the levels and clamps at 1 and 5', async () => {
    await mount();
    const zoomIn = screen.getByRole('button', { name: '확대' });
    const zoomOut = screen.getByRole('button', { name: '축소' });
    expect((zoomOut as HTMLButtonElement).disabled).toBe(true);
    for (let n = 2; n <= 5; n++) {
      fireEvent.click(zoomIn);
      expect(pressed()).toBe(n);
    }
    expect((zoomIn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(zoomIn);
    expect(pressed()).toBe(5);
    fireEvent.click(zoomOut);
    expect(pressed()).toBe(4);
  });

  it('announces the level politely when it settles', async () => {
    await mount();
    goLevel(4);
    expect(screen.getByText('확대 수준 4/5', { selector: '[aria-live]' })).toBeTruthy();
  });

  it('+ · - · 0 work while the scene has focus', async () => {
    await mount();
    const scene = screen.getByRole('group', { name: /사무실 장면/ });
    expect(scene.tabIndex).toBe(0);
    fireEvent.keyDown(scene, { key: '+' });
    fireEvent.keyDown(scene, { key: '=' });
    expect(pressed()).toBe(3);
    fireEvent.keyDown(scene, { key: '-' });
    expect(pressed()).toBe(2);
    fireEvent.keyDown(scene, { key: '0' });
    expect(pressed()).toBe(1);
    // ⌘+ stays the browser's own zoom
    fireEvent.keyDown(scene, { key: '+', metaKey: true });
    expect(pressed()).toBe(1);
  });
});

describe('wheel', () => {
  const wheel = (el: Element, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 600, clientY: 380, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it('on the office page a plain wheel over the scene zooms — one notch, one level — and the page does not scroll', async () => {
    const { zoom } = await mount();
    const e = wheel(screen.getByRole('group'), { deltaY: -100 });
    expect(e.defaultPrevented).toBe(true);
    expect(zoom.level()).toBe(2);
    // a macOS mouse notch is 4.000244 px — still a whole level
    const mac = wheel(screen.getByTestId('canvas'), { deltaY: -4.000244140625 });
    expect(mac.defaultPrevented).toBe(true);
    expect(zoom.level()).toBe(3);
    wheel(screen.getByRole('group'), { deltaY: 100, deltaMode: 0 });
    expect(zoom.level()).toBe(2);
  });

  it('a wheel outside the scene is left to the page', async () => {
    const { zoom } = await mount();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const e = wheel(outside, { deltaY: 400 });
    expect(e.defaultPrevented).toBe(false);
    expect(zoom.view.zoom).toBe(1);
    outside.remove();
  });

  it('ctrl+wheel (a trackpad pinch) follows the fingers toward the pointer', async () => {
    const { zoom } = await mount();
    const e = wheel(screen.getByRole('group'), { deltaY: -6.5, ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(zoom.view.zoom).toBeGreaterThan(1);
    expect(zoom.view.zoom).toBeLessThan(zoom.frame!.levels[1]);
  });

  it('zooms in full screen — the pop-out (or the page) made full screen keeps the same listeners', async () => {
    const { zoom } = await mount({ display: true, storageKey: zoomKey('tesla', 'charging', true) });
    const group = screen.getByRole('group');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement });
    document.dispatchEvent(new Event('fullscreenchange'));
    const e = wheel(group, { deltaY: -100 });
    expect(e.defaultPrevented).toBe(true);
    expect(zoom.level()).toBe(2);
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  });
});

describe('drag', () => {
  const ptr = (el: Element, type: string, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.assign(e, { pointerId: 1, pointerType: 'mouse' });
    el.dispatchEvent(e);
  };
  const drag = (el: Element, steps: [number, number][]) => {
    const [x0, y0] = steps[0];
    ptr(el, 'pointerdown', x0, y0);
    for (const [x, y] of steps.slice(1)) ptr(el, 'pointermove', x, y);
    const [x1, y1] = steps[steps.length - 1];
    ptr(el, 'pointerup', x1, y1);
    fireEvent.click(el, { clientX: x1, clientY: y1 });
  };

  it('pans the room (pointer down · move · up) and does not open the agent modal', async () => {
    const { zoom, onSelect } = await mount();
    goLevel(3);
    const canvas = screen.getByTestId('canvas');
    const before = { ...zoom.view };
    drag(canvas, [
      [600, 380],
      [610, 384],
      [640, 400],
      [680, 420],
    ]);
    expect(zoom.view.u).toBeLessThan(before.u); // dragged right → the view moves left
    expect(zoom.view.v).toBeGreaterThan(before.v); // dragged down → the view moves up
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a small wobble (under 4 px) is still a click', async () => {
    const { zoom, onSelect } = await mount();
    goLevel(3);
    const canvas = screen.getByTestId('canvas');
    const before = { ...zoom.view };
    drag(canvas, [
      [600, 380],
      [602, 381],
    ]);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(zoom.view).toEqual(before);
  });

  it('at L1 the room follows the drag a little and springs back', async () => {
    const { zoom } = await mount();
    const canvas = screen.getByTestId('canvas');
    const fit = zoom.frame!.fit;
    ptr(canvas, 'pointerdown', 600, 380);
    ptr(canvas, 'pointermove', 700, 380);
    expect(zoom.view.u).toBeLessThan(fit.u);
    ptr(canvas, 'pointerup', 700, 380);
    expect(zoom.view.u).toBeCloseTo(fit.u, 6);
  });

  it('a drag that starts on a team label pans instead of zooming to the team', async () => {
    const { zoom } = await mount();
    goLevel(2);
    const label = screen.getAllByRole('button', { name: /팀으로 확대/ })[0];
    const before = { ...zoom.view };
    drag(label, [
      [300, 300],
      [340, 300],
    ]);
    expect(zoom.view.zoom).toBe(before.zoom);
    expect(zoom.view.u).not.toBe(before.u);
  });

  it('shows the grab cursor class while dragging', async () => {
    await mount();
    const group = screen.getByRole('group');
    ptr(screen.getByTestId('canvas'), 'pointerdown', 600, 380);
    act(() => ptr(screen.getByTestId('canvas'), 'pointermove', 640, 380));
    expect(group.classList.contains('is-dragging')).toBe(true);
    act(() => ptr(screen.getByTestId('canvas'), 'pointerup', 640, 380));
    expect(group.classList.contains('is-dragging')).toBe(false);
  });
});

describe('name tags', () => {
  const tagOf = (label: string) => screen.getByTitle(new RegExp(`^${label} · `));

  it('idle tags hide at L1–L2 and all show from L3', async () => {
    await mount({ statuses: { e1: 'typing' } });
    expect(tagOf('Ann').classList.contains('is-quiet')).toBe(true);
    expect(tagOf('Eng 1').classList.contains('is-quiet')).toBe(false);
    goLevel(2);
    expect(tagOf('Ann').classList.contains('is-quiet')).toBe(true);
    for (const n of [3, 4, 5]) {
      goLevel(n);
      expect(screen.getAllByTitle(/ · /).every((el) => !el.classList.contains('is-quiet'))).toBe(true);
    }
  });

  it('carry a collision priority: waiting and error before the working, idle last', async () => {
    await mount({ statuses: { a: 'waiting', b: 'error', e0: 'typing' } });
    const prio = (l: string) => Number(tagOf(l).dataset.prio);
    expect(prio('Ann')).toBeLessThan(prio('Ben'));
    expect(prio('Ben')).toBeLessThan(prio('Eng 0'));
    expect(prio('Eng 0')).toBeLessThan(prio('Eng 1'));
  });
});

describe('focus', () => {
  it('a team label zooms to that team, centred on its pod', async () => {
    const { zoom } = await mount();
    const labels = screen.getAllByRole('button', { name: /팀으로 확대/ });
    expect(labels).toHaveLength(2); // brand, engineering — not Chief's desk
    fireEvent.click(labels.find((b) => b.textContent !== '' && /engineering|엔지니어링/i.test(b.getAttribute('aria-label') ?? ''))!);
    expect(zoom.level()).toBe(zoom.frame!.teams.engineering.level);
    expect(zoom.level()).toBeGreaterThan(1);
    const pod = zoom.frame!.teams.engineering;
    expect(zoom.view.u).toBeCloseTo(pod.u, 1);
  });

  it('a double-click on a penguin zooms to L5 on it; a single click still opens the modal', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const focused: string[] = [];
    const c = seatClicks({ onSelect, onFocus: (a) => focused.push(a) });
    // a double-click: click (detail 1) · click (detail 2) · dblclick
    c.click('e3', 1, 0);
    c.click('e3', 2, 0);
    c.dblclick('e3');
    vi.advanceTimersByTime(1000);
    expect(onSelect).not.toHaveBeenCalled();
    expect(focused).toEqual(['e3']);
    // one click opens the agent after the double-click window
    c.click('e3', 1, 0);
    vi.advanceTimersByTime(300);
    expect(onSelect).toHaveBeenCalledWith('e3');
    // the end of a drag is not a click
    c.click('e3', 1, 12);
    vi.advanceTimersByTime(300);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('focusing an agent lands on L5 centred on its desk', async () => {
    const { zoom } = await mount();
    act(() => void zoom.focusAgent('e3'));
    expect(pressed()).toBe(5);
    expect(zoom.view.u).toBeCloseTo(zoom.frame!.agents.e3.u, 3);
  });
});

describe('memory', () => {
  it('restores the level and the centre on a revisit; the pop-out keeps its own', async () => {
    const first = await mount();
    act(() => void first.zoom.focusAgent('e5'));
    const saved = loadZoom(KEY)!;
    expect(saved.level).toBe(5);
    first.unmount();
    const again = await mount();
    expect(pressed()).toBe(5);
    expect(again.zoom.view.u).toBeCloseTo(saved.u, 2);
    again.unmount();
    await mount({ display: true, storageKey: zoomKey('tesla', 'charging', true) });
    expect(pressed()).toBe(1);
  });
});

describe('fallback', () => {
  it('the WebGL-off list has no zoom control', async () => {
    window.history.replaceState(null, '', '/?webgl=off');
    renderWith(<OfficeStage agents={seats} statuses={{}} theme="light" onSelect={() => {}} fallback={<p>list</p>} storageKey={KEY} />);
    expect(screen.getByText('list')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: '확대' })).toBeNull();
  });
});
