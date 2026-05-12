import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  listOrganizations,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";
import { syncAgentsToOrg, listSourceAgents } from "../../bot/agents-builder.js";
import { getAgentsDir } from "../../util/paths.js";

const TARGET = "1.3.0";

/**
 * v1.2.4 → v1.3.0 — PM mode (Phase A).
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §7 + PoC #1/#2 findings.
 *
 * Per-org changes (non-destructive):
 *   - Create `<org>/.solosquad/sessions/` (empty; populated by pm-runner as
 *     users send their first messages)
 *   - Sync `<org>/.claude/agents/<name>.md` from `assets/agents/{team}/{agent}/SKILL.md`
 *     for all 25 specialists (Claude Code's filesystem subagent discovery)
 *
 * Workspace changes:
 *   - Add `pm` section to workspace.yaml with defaults (max_budget_usd, etc.)
 *   - Bump version 1.2.4 → 1.3.0
 *
 * No JSONL memory or existing workflow data is touched. Existing
 * `claude-runner.ts` single-shot path remains for scheduler routines.
 */
export const migration: Migration = {
  from: "1.2.4",
  to: TARGET,
  description:
    "PM mode: per-org sessions/, .claude/agents/ sync (25 specialists), workspace.yaml pm section.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return ws.version === "1.2.4";
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);
    const sources = listSourceAgents(getAgentsDir());

    for (const o of orgs) {
      const sessionsDir = path.join(o.path, ".solosquad", "sessions");
      if (!fs.existsSync(sessionsDir)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/.solosquad/sessions/`,
          description: `Create PM session-id store dir for ${o.slug}`,
        });
      }
      steps.push({
        kind: "generate",
        to: `${o.slug}/.claude/agents/`,
        description: `Sync ${sources.length} specialist agent file(s) into ${o.slug}/.claude/agents/`,
      });
    }

    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: "Add pm section with defaults (max_budget_usd=$5, timeout=300s, partial messages on)",
    });
    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: `Bump version: 1.2.4 → ${TARGET}`,
    });
    steps.push({
      kind: "note",
      description:
        "Bot/scheduler restart required. The new bot uses a PM session per (user, org) via `claude --resume`. " +
        "If your org has multiple users, each will create their own session on first message. " +
        "Existing keyword routing (`agent-router.ts`) is no longer used for the primary path — it remains as fallback only.",
    });

    return {
      steps,
      warnings: [
        "After migration, restart `solosquad bot` so PM mode takes effect.",
        "Run `claude auth status` to verify Claude Code login is healthy — PM mode requires it.",
        "Agent files synced from assets/agents/. To customize, edit `<org>/.claude/agents/<name>.md` after migration.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: orgs.length * sources.length * 0.005,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const orgs = listOrganizations(workspace);

    for (const o of orgs) {
      const sessionsDir = path.join(o.path, ".solosquad", "sessions");
      fs.mkdirSync(sessionsDir, { recursive: true });
      syncAgentsToOrg(workspace, o.slug);
    }

    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      ws.pm = { ...DEFAULT_WORKSPACE_SETTINGS.pm, ...(ws.pm ?? {}) };
      ws.version = TARGET;
      ws.last_migrated_to = TARGET;
      saveWorkspaceYaml(ws, workspace);
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml version ${ws.version} != ${TARGET}` };
    }
    if (!ws.pm) {
      return { ok: false, error: "workspace.yaml.pm missing after migration" };
    }
    if (typeof ws.pm.max_budget_usd !== "number") {
      return { ok: false, error: "workspace.yaml.pm.max_budget_usd missing/invalid" };
    }

    const orgs = listOrganizations(workspace);
    if (orgs.length === 0) return { ok: true };

    const sources = listSourceAgents(getAgentsDir());
    for (const o of orgs) {
      const sessionsDir = path.join(o.path, ".solosquad", "sessions");
      if (!fs.existsSync(sessionsDir)) {
        return { ok: false, error: `${o.slug}/.solosquad/sessions/ missing` };
      }
      const agentsDir = path.join(o.path, ".claude", "agents");
      if (!fs.existsSync(agentsDir)) {
        return { ok: false, error: `${o.slug}/.claude/agents/ missing` };
      }
      const written = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).length;
      if (written < sources.length) {
        return {
          ok: false,
          error: `${o.slug}/.claude/agents/ has ${written} files, expected ≥ ${sources.length}`,
        };
      }
    }

    return { ok: true };
  },
};
