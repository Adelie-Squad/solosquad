import { SessionStore } from "../bot/session-store.js";
import { listOrganizations } from "../util/config.js";

/**
 * v1.4.0 (§5.7) — common migration helper: archive (rotate) every org's active
 * Chief session.
 *
 * **When to call.** A release that changes how the bot *spawns* Chief — the
 * input path, permission model, tool availability, or system-prompt structure —
 * makes an already-resumed Chief session's transcript MISLEADING: old turns like
 * "접근 불가 / 허용 누르세요 / 차단" linger in the conversation and steer the agent
 * even though the spawn args (rebuilt every turn) already carry the fix. Such a
 * migration should force a clean slate.
 *
 * **What it does (and doesn't).** Rotates the session-id for each (org, user)
 * Chief session — the old id is archived into `SessionRecord.archived[]` with
 * the given reason; the next bot turn starts fresh (same path as the existing
 * session-not-found → rotate recovery). Workspace files, repos, and cumulative
 * cost are untouched (rotate preserves `totalCostUsd`).
 *
 * **When NOT to call.** A plain version bump with no spawn change must skip this
 * — rotating would needlessly drop continuity (the registry-continuity
 * invariant). The migration author gates on "does this release change spawn
 * behaviour?" before calling.
 *
 * Returns one entry per rotated session (for logging / verify).
 */
export interface ArchivedChiefSession {
  org: string;
  userId: string;
  previous: string | null;
  next: string;
}

export function archiveOrgChiefSessions(
  workspace: string,
  reason: string
): ArchivedChiefSession[] {
  const store = new SessionStore(workspace);
  const out: ArchivedChiefSession[] = [];
  for (const org of listOrganizations(workspace)) {
    for (const rec of store.listForOrg(org.slug)) {
      const { previous, next } = store.rotate(org.slug, rec.userId, reason);
      out.push({ org: org.slug, userId: rec.userId, previous, next });
    }
  }
  return out;
}
