import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  listOrganizations,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";

/**
 * v1.3.7 → v1.3.8 — docs management system + `docs` skill.
 *
 * Per docs/prd/v1.3.8_docs-management.md. docs·version are REPOSITORY-scoped;
 * the two-layer split (§2-⑵) puts release-bound docs (prd/architecture/roadmap/
 * README/CHANGELOG/manual) in each repo and exploratory docs (ideation/reports)
 * in the ORG workspace (cross-repo, product research).
 *
 * Per-org change (non-destructive, force-seed — OQ#2 resolved):
 *   - Ensure the org-layer dirs exist: `<org>/docs/ideation/` and
 *     `<org>/docs/reports/`, each with a seed `INDEX.md` if missing.
 *   - Workspace = SoloSquad-managed area, so this never touches a founder's
 *     external repo working tree (class A user-code rule stays intact). Repo
 *     layer (prd/architecture/…) is NOT seeded — it is authored during repo
 *     work via the normal commit flow.
 *
 * Workspace change: bump version 1.3.7 → 1.3.8 (registry-continuity invariant).
 *
 * Idempotent: detect() matches "1.3.7" only; seeding skips existing files/dirs.
 */

const TARGET = "1.3.8";

const SEED_INDEX: Record<"ideation" | "reports", string> = {
  ideation: [
    "# Ideation INDEX — org 계층 (발산 · cross-repo)",
    "",
    "> 제품 관점 발산/탐색(왜·만약). 결정 전, 폐기 안 함. 여러 repo 가 참조.",
    "> 신규는 `<name>_<YYMMDD>.md` 규칙. (docs 스킬 §2)",
    "",
  ].join("\n"),
  reports: [
    "# Reports INDEX — org 계층 (근거 스냅샷 · cross-repo)",
    "",
    '> "무엇이 사실인가" — 제품 관점 조사·근거. PRD 가 `evidence_ref` 로 인용.',
    "> 신규는 `<name>_<YYMMDD>.md` 규칙. (docs 스킬 §2)",
    "",
  ].join("\n"),
};

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.7" || version.startsWith("1.3.7.");
}

function orgDocLayerDir(orgPath: string, layer: "ideation" | "reports"): string {
  return path.join(orgPath, "docs", layer);
}

export const migration: Migration = {
  from: "1.3.7",
  to: TARGET,
  description:
    "v1.3.8 — docs management + `docs` skill. Force-seeds org-layer docs/ideation/ + docs/reports/ (with INDEX.md) into each org workspace; repo-layer docs untouched. Stamps workspace at 1.3.8.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);

    for (const o of orgs) {
      for (const layer of ["ideation", "reports"] as const) {
        const dir = orgDocLayerDir(o.path, layer);
        const index = path.join(dir, "INDEX.md");
        if (!fs.existsSync(index)) {
          steps.push({
            kind: "generate",
            to: `${o.slug}/docs/${layer}/INDEX.md`,
            description: `Seed org-layer ${layer}/ + INDEX.md for ${o.slug}`,
          });
        }
      }
    }

    const ws = loadWorkspaceYaml(workspace);
    steps.push({
      kind: "update",
      from: `workspace.yaml.version=${ws?.version ?? "(unset)"}`,
      to: `workspace.yaml.version=${TARGET}`,
      description: "Bump workspace version to 1.3.8",
    });

    return {
      steps,
      warnings: [],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      for (const layer of ["ideation", "reports"] as const) {
        const dir = orgDocLayerDir(o.path, layer);
        fs.mkdirSync(dir, { recursive: true });
        const index = path.join(dir, "INDEX.md");
        if (!fs.existsSync(index)) {
          fs.writeFileSync(index, SEED_INDEX[layer]);
        }
      }
    }

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
    for (const o of listOrganizations(workspace)) {
      for (const layer of ["ideation", "reports"] as const) {
        const index = path.join(orgDocLayerDir(o.path, layer), "INDEX.md");
        if (!fs.existsSync(index)) {
          return {
            ok: false,
            error: `${o.slug}/docs/${layer}/INDEX.md missing after apply`,
          };
        }
      }
    }
    return { ok: true };
  },
};
