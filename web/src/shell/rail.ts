// The sidebar's collapsed rail (user, 2026-11-09 — DESIGN.md `## 레이아웃` 접힌 사이드바): a button
// at the sidebar's top right folds it to a 60px column of icons and back. The choice is kept in
// this browser; ⌘\ (Ctrl+\ elsewhere) toggles it — ⌘K stays the quick jump. On a phone the sidebar
// is a drawer and there is no rail.
import { useCallback, useEffect, useState } from 'react';

export const RAIL_KEY = 'solosquad.sidebar';

export function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'rail';
  } catch {
    return false;
  }
}

export function writeRail(rail: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, rail ? 'rail' : 'open');
  } catch {
    /* a private window without storage keeps the choice for this page only */
  }
}

/** Is this key press the toggle? ⌘\ or Ctrl+\ (no other modifier). */
export const isRailShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '\\';

export function useRail(): [boolean, () => void] {
  const [rail, setRail] = useState(readRail);
  const toggle = useCallback(() => {
    setRail((r) => {
      writeRail(!r);
      return !r;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isRailShortcut(e)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return [rail, toggle];
}
