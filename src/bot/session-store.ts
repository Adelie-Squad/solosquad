import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getOrgDir } from "../util/paths.js";

/**
 * v0.3.0 — Chief session-id store (named "PM session" pre-v1.1).
 *
 * Maps (userId, orgSlug) → Claude Code session-id. The actual conversation
 * transcript lives in `~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`
 * (managed by Claude Code itself, per PoC #1). We only persist the mapping
 * + light bookkeeping (last interaction, cumulative cost, active workflow).
 *
 * File layout per org:
 *   <workspace>/<org>/.solosquad/sessions/<user-id>.json
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §3.2 / §3.2.1.
 */

export interface SessionRecord {
  userId: string;
  orgSlug: string;
  sessionId: string;
  createdAt: string;
  lastInteractionAt: string;
  totalCostUsd: number;
  activeWorkflowId?: string;
  archived?: Array<{ sessionId: string; archivedAt: string; reason: string }>;
  /**
   * v0.5 §7 — freq channel hysteresis. Map of SKILL name → turns remaining
   * before that SKILL can be auto-loaded again. Caller (router-runner) ticks
   * the counter each turn via `tickCooldowns()` and records new entries
   * returned by `resolve()`'s `start_cooldown`.
   */
  freqCooldowns?: Record<string, number>;
}

function sessionsDir(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), ".solosquad", "sessions");
}

function recordPath(workspace: string, orgSlug: string, userId: string): string {
  return path.join(sessionsDir(workspace, orgSlug), `${safeFileName(userId)}.json`);
}

function safeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export class SessionStore {
  constructor(private readonly workspace: string) {}

  read(orgSlug: string, userId: string): SessionRecord | null {
    const p = recordPath(this.workspace, orgSlug, userId);
    if (!fs.existsSync(p)) return null;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  ensure(orgSlug: string, userId: string): { record: SessionRecord; fresh: boolean } {
    const existing = this.read(orgSlug, userId);
    if (existing) return { record: existing, fresh: false };

    const now = new Date().toISOString();
    const record: SessionRecord = {
      userId,
      orgSlug,
      sessionId: randomUUID(),
      createdAt: now,
      lastInteractionAt: now,
      totalCostUsd: 0,
    };
    this.write(record);
    return { record, fresh: true };
  }

  write(record: SessionRecord): void {
    const dir = sessionsDir(this.workspace, record.orgSlug);
    fs.mkdirSync(dir, { recursive: true });
    const p = recordPath(this.workspace, record.orgSlug, record.userId);
    fs.writeFileSync(p, JSON.stringify(record, null, 2) + "\n", "utf-8");
  }

  rotate(
    orgSlug: string,
    userId: string,
    reason: string
  ): { previous: string | null; next: string } {
    const existing = this.read(orgSlug, userId);
    const now = new Date().toISOString();
    const next = randomUUID();

    if (existing) {
      const previous = existing.sessionId;
      existing.archived = existing.archived ?? [];
      existing.archived.push({ sessionId: previous, archivedAt: now, reason });
      existing.sessionId = next;
      existing.lastInteractionAt = now;
      this.write(existing);
      return { previous, next };
    }

    const record: SessionRecord = {
      userId,
      orgSlug,
      sessionId: next,
      createdAt: now,
      lastInteractionAt: now,
      totalCostUsd: 0,
    };
    this.write(record);
    return { previous: null, next };
  }

  recordTurn(orgSlug: string, userId: string, costUsdDelta: number): void {
    const existing = this.read(orgSlug, userId);
    if (!existing) return;
    existing.lastInteractionAt = new Date().toISOString();
    existing.totalCostUsd =
      Math.round((existing.totalCostUsd + costUsdDelta) * 1_000_000) / 1_000_000;
    this.write(existing);
  }

  setActiveWorkflow(orgSlug: string, userId: string, workflowId: string | undefined): void {
    const existing = this.read(orgSlug, userId);
    if (!existing) return;
    if (workflowId) existing.activeWorkflowId = workflowId;
    else delete existing.activeWorkflowId;
    this.write(existing);
  }

  /**
   * v0.5 §7 — apply one turn of cooldown decay + record any new freq match.
   * Pure update: returns nothing, persists the result. Idempotent on entries
   * that have already counted down to zero (they're dropped).
   */
  updateFreqCooldowns(
    orgSlug: string,
    userId: string,
    opts: { tick?: boolean; start?: { skillName: string; turns: number } | null } = {}
  ): void {
    const existing = this.read(orgSlug, userId);
    if (!existing) return;
    let cur = existing.freqCooldowns ?? {};
    if (opts.tick) {
      const next: Record<string, number> = {};
      for (const [name, n] of Object.entries(cur)) {
        const decremented = n - 1;
        if (decremented > 0) next[name] = decremented;
      }
      cur = next;
    }
    if (opts.start) {
      cur[opts.start.skillName] = opts.start.turns;
    }
    if (Object.keys(cur).length === 0) {
      delete existing.freqCooldowns;
    } else {
      existing.freqCooldowns = cur;
    }
    this.write(existing);
  }

  listForOrg(orgSlug: string): SessionRecord[] {
    const dir = sessionsDir(this.workspace, orgSlug);
    if (!fs.existsSync(dir)) return [];
    const out: SessionRecord[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        out.push(JSON.parse(raw) as SessionRecord);
      } catch {
        // skip corrupt
      }
    }
    return out;
  }
}
