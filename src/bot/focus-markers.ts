/**
 * v1.3.2 — parse `[focus:<wf-id>]` markers PM emits in assistant replies.
 *
 * When PM switches its mental "active workflow" from one to another, it
 * includes a single `[focus:wf-YYYY-MM-DD-slug]` line in its reply. pm-runner
 * reads the marker out of the assistant text and updates the SessionStore's
 * activeWorkflowId so the next turn's system prompt prefix reflects it.
 *
 * Special token `[focus:none]` clears the active workflow.
 *
 * The marker is invisible to the user — it sits on its own line and the
 * messenger doesn't render it specially. Cosmetically harmless.
 */

const FOCUS_RE = /\[focus:([A-Za-z0-9_.-]+)\]/g;

export interface FocusUpdate {
  /** New active workflow id, or null to clear. */
  workflowId: string | null;
}

/** Find the *last* focus marker in a text (PM's latest decision wins). */
export function parseFocusMarker(text: string): FocusUpdate | null {
  if (!text) return null;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  FOCUS_RE.lastIndex = 0;
  while ((match = FOCUS_RE.exec(text)) !== null) {
    last = match;
  }
  if (!last) return null;
  const val = last[1];
  if (val === "none") return { workflowId: null };
  return { workflowId: val };
}

/** Optionally strip focus markers from a reply before forwarding to messenger. */
export function stripFocusMarkers(text: string): string {
  return text.replace(/\s*\[focus:[A-Za-z0-9_.-]+\]\s*/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}
