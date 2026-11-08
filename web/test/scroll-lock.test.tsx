// Modal scroll containment (DESIGN.md `## 컴포넌트` — 모달 스크롤 가두기 · user 2026-11-09): while any
// modal is open the page behind it holds still — wheel and touch over the modal stay in the modal,
// over the scrim they do nothing — and on close the page is where it was. Every overlay in the app
// takes part, the landing's team modal and the agent · person modals included.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentModal } from '../src/components/AgentModal';
import { Modal } from '../src/components/Modal';
import { LOCK_ATTR, lockScroll, scrollLocked } from '../src/components/scrollLock';
import type { Agent } from '../src/api/types.gen';
import { renderWith } from './helpers';

const root = document.documentElement;
const agent: Agent = { name: 'finance', description: 'books', display_name: { en: 'Finance' }, summary: {}, team: 'business', layer: 'package', appearance: null, working_on: [] };

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 1800, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the page holds still under a modal', () => {
  it('locks on open, keeps the scroll position, unlocks and puts it back on close', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const onClose = vi.fn();
    const { unmount } = renderWith(
      <Modal label="Team" onClose={onClose}>
        <p>cards</p>
      </Modal>,
      'en',
    );
    expect(root.style.overflow).toBe('hidden');
    expect(root.hasAttribute(LOCK_ATTR)).toBe(true);
    expect(scrollLocked()).toBe(true);
    // the page was not moved to lock it
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(1800);

    // wheel and touch over the scrim do nothing; over the dialog they are the dialog's own
    const scrim = document.querySelector('.command-overlay')!;
    const overScrim = new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true });
    scrim.dispatchEvent(overScrim);
    expect(overScrim.defaultPrevented).toBe(true);
    const touch = new Event('touchmove', { bubbles: true, cancelable: true });
    scrim.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    const dialog = screen.getByRole('dialog', { name: 'Team' });
    const overDialog = new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true });
    screen.getByText('cards').dispatchEvent(overDialog);
    expect(overDialog.defaultPrevented).toBe(false);
    expect(dialog).toBeTruthy();

    // something nudged the page while the modal was up (a browser quirk) — close puts it back
    window.scrollY = 0;
    unmount();
    await waitFor(() => expect(root.style.overflow).toBe(''));
    expect(root.hasAttribute(LOCK_ATTR)).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, left: 0, behavior: 'instant' });
  });

  it('is counted: a modal over a modal unlocks only when the last one closes', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const a = lockScroll();
    const b = lockScroll();
    a();
    expect(root.style.overflow).toBe('hidden');
    a(); // releasing twice is harmless
    expect(root.style.overflow).toBe('hidden');
    b();
    expect(root.style.overflow).toBe('');
  });

  it('the agent modal locks the page too, and Esc closes it and lets go', () => {
    const onClose = vi.fn();
    renderWith(<AgentModal agent={agent} status="idle" waiting={[]} onClose={onClose} />, 'en');
    expect(root.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(root.style.overflow).toBe('');
  });

  it('every scroller inside an overlay keeps its scroll to itself', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/design.css'), 'utf8');
    expect(css).toMatch(/\.command-overlay,\s*\.command-overlay \* \{\s*overscroll-behavior: contain;/);
    const landing = readFileSync(join(process.cwd(), 'src/styles/landing.css'), 'utf8');
    expect(landing).toMatch(/\.landing-strip \{[^}]*overscroll-behavior: contain;/);
  });

  it('every overlay in the app locks the page', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx')) files.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    const overlays = files.filter((f) => readFileSync(f, 'utf8').includes('command-overlay'));
    expect(overlays.length).toBeGreaterThanOrEqual(6);
    for (const f of overlays) expect(readFileSync(f, 'utf8'), f).toMatch(/useScrollLock\(|<ScrollLock \/>/);
  });
});
