// Is the person really here? (DESIGN.md `### 대시보드` 자리를 비운 동안 · PRD v2.1.0 digest)
// The engine counts a request as presence only when it says `X-Presence: 1`. The web says so
// while the tab is visible and the person touched the page in the last two minutes — opening
// the page counts as touching it. A refetch that a live event starts in a tab nobody looks at
// says nothing, so an open laptop overnight does not hide what happened while they were away.

export const PRESENCE_HEADER = 'X-Presence';
export const PRESENT_FOR_MS = 2 * 60_000;

let lastTouch = Date.now();
let installed = false;

export function touched(at = Date.now()): void {
  lastTouch = at;
}

export function isPresent(now = Date.now()): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return now - lastTouch < PRESENT_FOR_MS;
}

/** Listen for the person — once per page. */
export function watchPresence(target: Window = window): void {
  if (installed) return;
  installed = true;
  const mark = () => touched();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'] as const) target.addEventListener(ev, mark, { passive: true });
  target.document.addEventListener('visibilitychange', () => {
    if (target.document.visibilityState === 'visible') mark();
  });
}
