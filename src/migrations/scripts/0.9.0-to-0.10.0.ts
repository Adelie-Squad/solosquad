import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";

/**
 * v0.9.0.x → v0.10.0 — LLM Backend Abstraction.
 *
 * Per `docs/plan/v0.10-llm-backend-abstraction.md`. v0.10 introduces:
 * - `workspace.yaml.llm_backend?: "claude" | "codex"` — backend selection
 * - `solosquad init` Step 3.7 — backend choice prompt
 * - `src/llm/adapter.ts` — LlmAdapter interface + ClaudeAdapter (wrap) +
 *   CodexAdapter (stub that throws with plan reference)
 * - Master-guide / README: "Claude Code Max only" → backend selection
 *
 * On-disk schema change: backwards-compatible — `llm_backend` is optional;
 * existing v0.9.x workspaces default to "claude" at load time.
 *
 * The migration only bumps `workspace.yaml.version`. It does NOT auto-
 * populate `llm_backend` for existing workspaces — that field is implicit
 * "claude" via load-time fallback, and explicit value is only set on fresh
 * init (Step 3.7) or by manual yaml edit.
 *
 * Idempotent: re-running on 0.10.0 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "0.9.0";
const TARGET = "0.10.0";

export const migration: Migration = {
  from: "0.9.0.x",
  to: TARGET,
  description:
    "v0.10.0 LLM backend abstraction — version bump only (no schema changes; llm_backend is optional with claude-fallback)",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    const v = typeof ws.version === "string" ? ws.version : "";
    return v === SOURCE_PREFIX || v.startsWith(SOURCE_PREFIX + ".");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.10.0",
      });
    }
    return {
      steps,
      warnings: [
        "v0.10.0 introduces workspace.yaml.llm_backend (optional). " +
          "Existing workspaces default to 'claude' implicitly. " +
          "To explicitly choose, edit workspace.yaml or re-run `solosquad init` Step 3.7.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return;
    ws.version = TARGET;
    ws.last_migrated_to = TARGET;
    saveWorkspaceYaml(ws, workspace);
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return {
        ok: false,
        error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}`,
      };
    }
    return { ok: true };
  },
};
