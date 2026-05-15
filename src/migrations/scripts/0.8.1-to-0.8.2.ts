import path from "path";
import fs from "fs";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  DEFAULT_DEV_CAPABILITY_DENYLIST,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  type DevCapabilityConfig,
  type WorkspaceYaml,
} from "../../util/config.js";
import { getAssetsDir } from "../../util/paths.js";
import { normalizeLine } from "../../util/platform.js";

const SOURCE_PREFIX = "0.8.1";
const TARGET = "0.8.2";

/**
 * v0.8.1 → v0.8.2 — Dev Capability.
 *
 * Per docs/plan/v0.8.2-dev-capability.md §8. Idempotent: re-running on a
 * 0.8.2 workspace is a no-op (`detect()` returns false).
 *
 * What changes:
 *
 *   1. `workspace.yaml.version` 0.8.1 → 0.8.2
 *   2. `workspace.yaml.dev_capability` defaults are filled in:
 *      - `enabled: true`
 *      - `require_push_confirmation: true`
 *      - `bash_denylist: [...DEFAULT_DEV_CAPABILITY_DENYLIST]`
 *   3. Verify: all 25 bundled SKILLs have `dev_capability` populated (5 true,
 *      20 false). The bundled assets are already injected by
 *      `scripts/inject-dev-capability.ts` at release-prep time — this verify
 *      step is a guard against shipping a corrupt npm tarball.
 *
 * Note: user-overridden SKILLs in `<org>/.claude/agents/` are *not* touched —
 * the user's own SKILL files keep their existing frontmatter. The PM session
 * loads workspace.yaml.dev_capability as the master toggle either way.
 */

interface WorkspaceYamlV082 extends WorkspaceYaml {
  dev_capability?: DevCapabilityConfig;
}

export const migration: Migration = {
  from: SOURCE_PREFIX,
  to: TARGET,
  description:
    "v0.8.2 Dev Capability — version bump 0.8.1 → 0.8.2 + workspace.yaml.dev_capability defaults + bundled SKILL frontmatter verify",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    if (typeof ws.version !== "string") return false;
    // Match either "0.8.1" exact, or any pre-release variant "0.8.1-*".
    return ws.version === SOURCE_PREFIX || ws.version.startsWith(`${SOURCE_PREFIX}-`);
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV082 | null;
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.8.2",
      });
      if (!ws.dev_capability) {
        steps.push({
          kind: "update",
          to: "workspace.yaml.dev_capability",
          description:
            "Add dev_capability defaults (enabled: true, require_push_confirmation: true, bash_denylist: …)",
        });
      }
    }
    steps.push({
      kind: "note",
      description:
        "Verify 25 bundled SKILL.md frontmatter has dev_capability set (5 engineering true + 20 false). Run scripts/inject-dev-capability.ts to re-stamp if missing.",
    });
    return {
      steps,
      warnings: [
        "v0.8.2 introduces a dev-confirm gate. `git push` / `gh pr merge` / `gh pr close` now block until the user replies `y` on their command channel.",
        "Workspace-level `bash_denylist` is enforced even when a SKILL allowlist includes the command — denylist wins.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const existing = loadWorkspaceYaml(workspace) as WorkspaceYamlV082 | null;
    if (!existing) {
      throw new Error("workspace.yaml missing — migrate aborts");
    }
    existing.version = TARGET;
    existing.dev_capability = {
      enabled: existing.dev_capability?.enabled ?? true,
      require_push_confirmation: true, // 박제 — false 거부
      bash_denylist:
        existing.dev_capability?.bash_denylist &&
        existing.dev_capability.bash_denylist.length > 0
          ? existing.dev_capability.bash_denylist
          : [...DEFAULT_DEV_CAPABILITY_DENYLIST],
    };
    saveWorkspaceYaml(existing, workspace);

    // Sentinel stamp so manual readers can see the bump.
    const ymlPath = path.join(workspace, ".solosquad", "workspace.yaml");
    if (fs.existsSync(ymlPath)) {
      const text = fs.readFileSync(ymlPath, "utf-8");
      if (!text.startsWith("# Bumped to 0.8.2")) {
        const stamped = `# Bumped to 0.8.2 — see CHANGELOG.md and docs/plan/v0.8.2-dev-capability.md\n${text}`;
        fs.writeFileSync(ymlPath, stamped);
      }
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV082 | null;
    if (!ws) return { ok: false, error: "workspace.yaml missing after migration" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `version still ${ws.version ?? "(unset)"} — expected ${TARGET}` };
    }
    if (!ws.dev_capability) {
      return { ok: false, error: "dev_capability defaults missing in workspace.yaml" };
    }
    if (ws.dev_capability.require_push_confirmation !== true) {
      return {
        ok: false,
        error:
          "dev_capability.require_push_confirmation must be true (false is forbidden per v0.8.2 §3.3)",
      };
    }
    if (
      !Array.isArray(ws.dev_capability.bash_denylist) ||
      ws.dev_capability.bash_denylist.length === 0
    ) {
      return { ok: false, error: "dev_capability.bash_denylist must be non-empty" };
    }

    // Bundled SKILL frontmatter check — best-effort. If bundled assets are
    // missing (e.g. running migration in a stripped tarball), warn only.
    const stamped = countBundledDevCapability();
    if (stamped !== null) {
      if (stamped.truthy !== 5 || stamped.falsy !== 20) {
        return {
          ok: false,
          error: `Bundled SKILL dev_capability stamp mismatch — expected 5 true + 20 false, got ${stamped.truthy} true + ${stamped.falsy} false. Re-run scripts/inject-dev-capability.ts.`,
        };
      }
    }
    return { ok: true };
  },
};

interface DevCapabilityStamp {
  truthy: number;
  falsy: number;
}

/**
 * Walk `assets/agents/{team}/{agent}/SKILL.md` and tally dev_capability values.
 * Returns null when the bundled assets dir is missing (tarball excluded /
 * dev checkout without a full asset tree) — caller treats that as "skip".
 */
function countBundledDevCapability(): DevCapabilityStamp | null {
  const root = path.join(getAssetsDir(), "agents");
  if (!fs.existsSync(root)) return null;

  let truthy = 0;
  let falsy = 0;
  for (const teamEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith("_")) continue;
    const teamDir = path.join(root, teamEntry.name);
    for (const agentEntry of fs.readdirSync(teamDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skill = path.join(teamDir, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skill)) continue;
      const text = normalizeLine(fs.readFileSync(skill, "utf-8"));
      const fmEnd = text.indexOf("\n---", 4);
      if (fmEnd < 0) continue;
      const fm = text.slice(4, fmEnd);
      const m = fm.match(/^dev_capability:\s*(true|false)\s*$/m);
      if (!m) continue;
      if (m[1] === "true") truthy++;
      else falsy++;
    }
  }
  return { truthy, falsy };
}
