// Light · dark · system (DESIGN.md `## 테마`). The first paint is decided by the inline
// script in index.html; this module keeps it in sync afterwards and follows the system
// setting live while the choice is "system".
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'solosquad.theme';
const EVENT = 'solosquad:theme';

/** `--bg` of each theme — the browser chrome colour (theme-color meta). */
export const CHROME: Record<Theme, string> = { light: '#EEE9DF', dark: '#15161B' };

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(pref: ThemePref, system: Theme = systemTheme()): Theme {
  return pref === 'system' ? system : pref;
}

/** Put `data-theme` on <html> (none = follow the system) and point the chrome colour at it. */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own: Theme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = CHROME[pref === 'system' ? own : pref];
  }
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // not remembered on this device; still applied now
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The chosen preference and the theme actually shown — updates on a system switch. */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => setSystem(mq?.matches ? 'dark' : 'light');
    const onPref = () => setPrefState(readPref());
    mq?.addEventListener?.('change', onSystem);
    window.addEventListener(EVENT, onPref);
    window.addEventListener('storage', onPref);
    return () => {
      mq?.removeEventListener?.('change', onSystem);
      window.removeEventListener(EVENT, onPref);
      window.removeEventListener('storage', onPref);
    };
  }, []);
  return { pref, theme: resolveTheme(pref, system), setPref: setThemePref };
}

/** After the first paint, let colour changes animate (DESIGN.md `## 모션`). */
export function enableThemeTransitions(): void {
  applyTheme(readPref());
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('theme-ready')));
}
