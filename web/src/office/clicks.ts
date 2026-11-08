// Clicks on a penguin (DESIGN.md `## 사무실 장면` — 확대 · 축소): one click opens the agent's
// modal, a double-click zooms to that agent's desk (L5) instead. The single click waits a beat
// for a possible second one — otherwise the modal would open under the second click. A press
// that moved (the end of a pan) is not a click at all.

/** How long a single click waits for a second one. */
export const DOUBLE_MS = 260;
/** Pointer travel (px) after which a press is a drag, not a click. */
export const DRAG_PX = 4;

export function seatClicks({ onSelect, onFocus, delay = DOUBLE_MS }: { onSelect: (agent: string) => void; onFocus: (agent: string) => void; delay?: number }) {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (pending) clearTimeout(pending);
    pending = null;
  };
  return {
    /** `detail` = the browser's click count, `moved` = px between press and release. */
    click(agent: string, detail: number, moved: number) {
      if (moved > DRAG_PX) return;
      cancel();
      if (detail >= 2) return; // the second click of a double-click — dblclick handles it
      pending = setTimeout(() => {
        pending = null;
        onSelect(agent);
      }, delay);
    },
    dblclick(agent: string) {
      cancel();
      onFocus(agent);
    },
    cancel,
  };
}
