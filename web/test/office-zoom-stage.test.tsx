// The zoom on the page (DESIGN.md `## 사무실 장면` — 확대 · 축소): the corner control steps the
// five levels and clamps, 전체 보기 resets, the keys work while the scene has focus, a plain
// wheel scrolls the office page but zooms the pop-out, ctrl / ⌘ + wheel zooms, a double-click
// on a penguin zooms to it (a single click still opens the modal), name tags all show from L3,
// the level is announced and remembered, and the WebGL-off list has no zoom.
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
    return <div data-testid="canvas" />;
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
  return { ...view, onSelect, zoom: lastZoom! };
}

const levelDot = (n: number) => screen.getByRole('button', { name: `확대 수준 ${n}/5` });
const pressed = () => [1, 2, 3, 4, 5].find((n) => levelDot(n).getAttribute('aria-pressed') === 'true');

describe('zoom control', () => {
  it('has labelled buttons: 축소 · five levels · 확대 · 전체 보기', async () => {
    await mount();
    for (const name of ['축소', '확대', '전체 보기']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(pressed()).toBe(1);
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
    fireEvent.click(levelDot(2));
    expect(pressed()).toBe(2);
  });

  it('전체 보기 goes back to L1 and announces the level politely', async () => {
    await mount();
    fireEvent.click(levelDot(4));
    expect(screen.getByText('확대 수준 4/5', { selector: '[aria-live]' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }));
    expect(pressed()).toBe(1);
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('확대 수준 1/5');
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

  it('a plain wheel scrolls the office page — no zoom, not prevented', async () => {
    const { zoom } = await mount();
    const e = wheel(screen.getByRole('group'), { deltaY: -400 });
    expect(e.defaultPrevented).toBe(false);
    expect(zoom.view.zoom).toBe(1);
  });

  it('ctrl+wheel (a trackpad pinch) and ⌘+wheel zoom toward the pointer', async () => {
    const { zoom } = await mount();
    const e = wheel(screen.getByRole('group'), { deltaY: -60, ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(zoom.view.zoom).toBeGreaterThan(1);
    const z = zoom.view.zoom;
    wheel(screen.getByRole('group'), { deltaY: -200, metaKey: true });
    expect(zoom.view.zoom).toBeGreaterThan(z);
  });

  it('on the pop-out display a plain wheel zooms', async () => {
    const { zoom } = await mount({ wheel: 'always', storageKey: zoomKey('tesla', 'charging', true) });
    const e = wheel(screen.getByRole('group'), { deltaY: -400 });
    expect(e.defaultPrevented).toBe(true);
    expect(zoom.view.zoom).toBeGreaterThan(1);
  });
});

describe('name tags', () => {
  const tagOf = (label: string) => screen.getByTitle(new RegExp(`^${label} · `));

  it('idle tags hide at L1–L2 and all show from L3', async () => {
    await mount({ statuses: { e1: 'typing' } });
    expect(tagOf('Ann').classList.contains('is-quiet')).toBe(true);
    expect(tagOf('Eng 1').classList.contains('is-quiet')).toBe(false);
    fireEvent.click(levelDot(2));
    expect(tagOf('Ann').classList.contains('is-quiet')).toBe(true);
    for (const n of [3, 4, 5]) {
      fireEvent.click(levelDot(n));
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
    expect(zoom.level()).toBe(3);
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
    await mount({ wheel: 'always', storageKey: zoomKey('tesla', 'charging', true) });
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
