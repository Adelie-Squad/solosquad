import path from "path";
import fs from "fs";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  type WorkspaceYaml,
} from "../../util/config.js";
import {
  injectAcross,
  listSkillFiles,
  injectSchemaVersion,
} from "../../lifecycle/skill-schema-version.js";

const SOURCE_PREFIX = "0.8.";
// We accept 0.8.0 explicitly and 0.7.0 (skipping a non-existent 0.7.x → 0.8.0
// migration when the user installed v0.8.1 fresh atop v0.7). The version
// stamp is the source of truth.
const SOURCE_PREFIX_LEGACY = "0.7.";
const TARGET = "0.8.1";

/**
 * v0.8.0 (or v0.7.x) → v0.8.1 — Security & Lifecycle Pair.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §9. This migration is
 * intentionally minimal:
 *
 *   1. Bump `workspace.yaml.version` to 0.8.1
 *   2. Backfill `schema_version: 1` into bundled + workspace SKILL.md
 *      files (idempotent — already-bumped files are left alone)
 *   3. Stamp a sentinel comment on workspace.yaml so manual readers can
 *      see the bump
 *
 * No data is rewritten, no agent-profile fields are touched. The new
 * `solosquad import` + `solosquad archive verify` commands are inert
 * until invoked by the user.
 */

interface WorkspaceYamlV081 {
  version?: string;
  uninstall?: Record<string, unknown>;
  [k: string]: unknown;
}

function findWorkspaceSkillDirs(workspace: string): string[] {
  const candidates = [
    path.join(workspace, ".solosquad", "agents"),
    path.join(workspace, "agents"), // legacy
  ];
  const orgsRoot = workspace;
  try {
    for (const e of fs.readdirSync(orgsRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const orgAgents = path.join(orgsRoot, e.name, ".agents");
      if (fs.existsSync(orgAgents)) candidates.push(orgAgents);
    }
  } catch {
    // ignore — workspace might not have orgs yet
  }
  return candidates.filter((p) => fs.existsSync(p));
}

export const migration: Migration = {
  from: "0.8.0",
  to: TARGET,
  description:
    "v0.8.1 Security & Lifecycle Pair — workspace.yaml bump + SKILL.md schema_version backfill",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    if (typeof ws.version !== "string") return false;
    return (
      ws.version.startsWith(SOURCE_PREFIX) ||
      ws.version.startsWith(SOURCE_PREFIX_LEGACY)
    );
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV081 | null;
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.8.1",
      });
    }

    // Plan: which SKILL.md files lack schema_version?
    const skillDirs = findWorkspaceSkillDirs(workspace);
    let willInject = 0;
    let alreadyHad = 0;
    for (const dir of skillDirs) {
      for (const f of listSkillFiles(dir)) {
        const content = fs.readFileSync(f, "utf-8");
        try {
          const updated = injectSchemaVersion(content);
          if (updated === null) alreadyHad++;
          else willInject++;
        } catch {
          // skip — malformed frontmatter, the apply step will surface it
        }
      }
    }
    if (willInject > 0 || alreadyHad > 0) {
      steps.push({
        kind: "update",
        to: `SKILL.md schema_version (inject=${willInject}, already=${alreadyHad})`,
        description:
          "Backfill `schema_version: 1` into workspace SKILL.md frontmatter (idempotent)",
      });
    }

    return {
      steps,
      warnings: [
        "v0.8.1 adds `solosquad import` + `solosquad archive verify/info/list` — see docs/policy/schema-stability.md before relying on schema_version.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const existing = loadWorkspaceYaml(workspace) as
      | (WorkspaceYaml & WorkspaceYamlV081)
      | null;
    if (!existing) {
      throw new Error("workspace.yaml missing — migrate aborts");
    }
    existing.version = TARGET;
    saveWorkspaceYaml(existing, workspace);

    const ymlPath = path.join(workspace, ".solosquad", "workspace.yaml");
    if (fs.existsSync(ymlPath)) {
      const text = fs.readFileSync(ymlPath, "utf-8");
      if (!text.startsWith("# Bumped to 0.8.1")) {
        const stamped =
          `# Bumped to 0.8.1 — see CHANGELOG.md and docs/plan/v0.8.1-security-lifecycle-pair.md\n${text}`;
        fs.writeFileSync(ymlPath, stamped);
      }
    }

    // SKILL.md schema_version backfill — idempotent across all known dirs.
    const skillDirs = findWorkspaceSkillDirs(workspace);
    for (const dir of skillDirs) {
      injectAcross(dir, 1);
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV081 | null;
    if (!ws) return { ok: false, error: "workspace.yaml missing after migration" };
    if (ws.version !== TARGET) {
      return {
        ok: false,
        error: `version still ${ws.version ?? "(unset)"} — expected ${TARGET}`,
      };
    }
    // Spot-check: no SKILL.md left without schema_version in workspace dirs.
    const skillDirs = findWorkspaceSkillDirs(workspace);
    for (const dir of skillDirs) {
      for (const f of listSkillFiles(dir)) {
        const content = fs.readFileSync(f, "utf-8");
        if (!/^schema_version\s*:/m.test(content.split("---")[1] ?? "")) {
          return { ok: false, error: `SKILL.md still missing schema_version: ${f}` };
        }
      }
    }
    return { ok: true };
  },
};
