// While a modal is open, the page behind it holds still (DESIGN.md `## 컴포넌트` — 모달 스크롤 가두기).
// Wheel, trackpad and touch over the modal scroll only the modal (its scrollers carry
// `overscroll-behavior: contain`); anywhere else they do nothing. The page keeps its scroll position
// — the root is only set to `overflow: hidden`, never moved — and on close the position is put back
// if anything nudged it. Ref-counted, so a modal opened over another one is fine.
import { useEffect } from 'react';

/** `<html data-scroll-lock>` while any modal holds the page — the landing's step controller reads it. */
export const LOCK_ATTR = 'data-scroll-lock';

let holders = 0;
let saved: { y: number; overflow: string; gutter: string } | null = null;

const inDialog = (target: EventTarget | null) => target instanceof Element && !!target.closest('[role="dialog"], [role="alertdialog"]');

/** Touch over the scrim (outside every dialog) would drag the page on iOS even with overflow hidden. */
const onTouchMove = (e: TouchEvent) => {
  if (e.cancelable && !inDialog(e.target)) e.preventDefault();
};
/** A wheel over the scrim never reaches a scroller; stop it before the browser tries the page. */
const onWheel = (e: WheelEvent) => {
  if (e.cancelable && !inDialog(e.target)) e.preventDefault();
};

export function lockScroll(): () => void {
  const root = document.documentElement;
  if (holders++ === 0) {
    const scrollbar = window.innerWidth - root.clientWidth;
    saved = { y: window.scrollY, overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.overflow = 'hidden';
    // keep the gutter so the page does not shift sideways when its scrollbar goes away
    if (scrollbar > 0) root.style.scrollbarGutter = 'stable';
    root.setAttribute(LOCK_ATTR, '');
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('wheel', onWheel, { passive: false });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders > 0 || !saved) return;
    const { y, overflow, gutter } = saved;
    saved = null;
    root.style.overflow = overflow;
    root.style.scrollbarGutter = gutter;
    root.removeAttribute(LOCK_ATTR);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('wheel', onWheel);
    if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  };
}

export const scrollLocked = () => typeof document !== 'undefined' && document.documentElement.hasAttribute(LOCK_ATTR);

/** Holds the page still for as long as the calling component (a modal) is mounted. */
export function useScrollLock(active = true): void {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}

/** The same as a component, for an overlay that is drawn conditionally inside a bigger view. */
export function ScrollLock(): null {
  useScrollLock();
  return null;
}
