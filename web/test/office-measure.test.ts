import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameLoop, measureNowObserver } from '../src/office/measure';

/** A ResizeObserver that, like a browser's in a page that is not rendering, never reports. */
class SilentObserver {
  observed: Element[] = [];
  constructor(_cb: ResizeObserverCallback) {}
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.observed = [];
  }
}

afterEach(() => vi.useRealTimers());

describe('office scene: the first size does not wait for a frame (stuck 불러오는 중)', () => {
  it('reports once right after observe, from a timer', () => {
    vi.useFakeTimers();
    const Observer = measureNowObserver(SilentObserver as unknown as typeof ResizeObserver)!;
    const cb = vi.fn();
    const ro = new Observer(cb);
    ro.observe(document.createElement('div'));
    expect(cb).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][1]).toBe(ro);
  });

  it('a disconnect before the timer cancels the report', () => {
    vi.useFakeTimers();
    const Observer = measureNowObserver(SilentObserver as unknown as typeof ResizeObserver)!;
    const cb = vi.fn();
    const ro = new Observer(cb);
    ro.observe(document.createElement('div'));
    ro.disconnect();
    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
  });

  it('no ResizeObserver at all → nothing to wrap', () => {
    expect(measureNowObserver(undefined)).toBeUndefined();
  });
});

describe('office scene: when it draws', () => {
  const base = { paused: false, offScreen: false, hidden: false, reducedMotion: false };
  it('every frame on a visible page', () => {
    expect(frameLoop(base)).toBe('always');
  });
  it('on demand in a hidden page — a screenshot of it still shows the office', () => {
    expect(frameLoop({ ...base, hidden: true })).toBe('demand');
    expect(frameLoop({ ...base, reducedMotion: true })).toBe('demand');
  });
  it('not at all in the pop-out or scrolled away', () => {
    expect(frameLoop({ ...base, paused: true, hidden: true })).toBe('never');
    expect(frameLoop({ ...base, offScreen: true })).toBe('never');
  });
});
