import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getOrgDir } from "../util/paths.js";

/**
 * v0.3.0 — PM session-id store.
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
