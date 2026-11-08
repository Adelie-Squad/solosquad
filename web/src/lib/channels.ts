// Same-origin messages between this browser's windows (BroadcastChannel). A window never hears
// its own message. Where the browser has none (old browsers, tests), nothing is sent.

/** Any change made through the API (approve · start a conversation · run a workflow …) — a nudge
 * for the office pop-out to ask again before the server's event arrives. */
export const DATA_CHANNEL = 'solosquad-data';
/** Log out · log in, shared by every window of this origin. */
export const SESSION_CHANNEL = 'solosquad-session';

export type SessionMessage = { type: 'logout' | 'login' };

export function openChannel(name: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
  } catch {
    return null;
  }
}

/** Post once on a short-lived channel. */
export function broadcast(name: string, message: unknown): void {
  const ch = openChannel(name);
  if (!ch) return;
  try {
    ch.postMessage(message);
  } catch {
    // closed under us — nothing to tell
  } finally {
    ch.close();
  }
}
