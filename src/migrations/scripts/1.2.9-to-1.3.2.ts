import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.2.9 → v1.3.2 — chain-completion (version bump, no on-disk data transform).
 *
 * Background: the v1.3.0 / v1.3.1 / v1.3.2 line shipped with no migration
 * script registered for source `1.2.9`, so the chain dead-ended at `1.2.9`
 * and `solosquad migrate` on any upgraded workspace threw
 * "No migration found for source version 1.2.9". This script closes that gap.
 * (The registry-continuity test added alongside it guards against the same
 * class of gap returning — see test/migration-registry-continuity.test.ts.)
 *
 * Why a single consolidated 1.2.9 → 1.3.2 step (not 1.3.0 → 1.3.1 → 1.3.2):
 * the workspace.yaml.version field only ever advances through migrations, and
 * no migration ever stamped a workspace `1.3.0` or `1.3.1` — so the only
 * upgraded-workspace source that can exist is `1.2.9`. Fresh installs of any
 * 1.3.x are written at target by `init` and never enter this path. Same
 * range-collapsing pattern as `1.1.0-to-1.2.6`.
 *
 * Why no data transform — what 1.3.0–1.3.2 actually changed to a workspace:
 *   - v1.3.0 (dev-confirm push-approval gate): the `workspace.yaml.pm.git`
 *     policy block is read through `resolveChiefGitConfig`, which fills every
 *     field from defaults when absent (`config.ts` — protected_branches /
 *     require_feature_branch / approval_timeout_minutes). The runtime dirs
 *     (`pending-confirms/`, `<org>/artifacts/`) are created on demand. Nothing
 *     to seed at migrate time.
 *   - v1.3.1 (legacy asset cleanup): bundle-internal only — "tarball behavior
 *     unchanged from 1.3.0". No user-workspace surface.
 *   - v1.3.2 (asset lifecycle managers + adoption): `schedules/<id>.yaml` is
 *     created when the user authors a cron; the CLI/manager changes are code,
 *     not stored state.
 *
 * So this migration only advances the version stamp (+ `last_migrated_to`) so
 * the chain can continue into `1.3.2 → 1.3.3`. Idempotent: detect() matches
 * "1.2.9" only; apply() is a plain version write.
 */

const TARGET = "1.3.2";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.9" || version.startsWith("1.2.9.");
}

export const migration: Migration = {
  from: "1.2.9",
  to: TARGET,
  description:
    "v1.3.2 — chain-completion version bump (1.2.9 → 1.3.2). The 1.3.0 dev-confirm gate, 1.3.1 legacy-asset cleanup, and 1.3.2 asset managers required no on-disk workspace transform (pm.git resolves defaults at read time; schedules/ + runtime dirs are created on demand). Advances the version stamp so the chain reaches 1.3.2 → 1.3.3.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.3.2",
      });
    }
    return {
      steps,
      warnings: [
        "v1.3.0 added the dev-confirm push-approval gate. `git push` / `gh pr merge` / `gh pr close` from a Chief spawn now require an approval tap in `command-<handle>`; direct pushes to main/master/develop are hard-blocked. Tune via workspace.yaml `pm.git` (protected_branches / require_feature_branch / approval_timeout_minutes) — all default when the block is absent.",
        "v1.3.2 added asset lifecycle managers + adoption. New front door `solosquad asset list|show|validate <kind>`; the `analyze repo` verb is deprecated in favor of `solosquad adopt`. LLM-judgment verbs (review / create-assist) moved into `solosquad chat`.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      ws.version = TARGET;
      ws.last_migrated_to = TARGET;
      saveWorkspaceYaml(ws, workspace);
    }
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
