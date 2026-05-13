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
import { getAssetsDir } from "../../util/paths.js";

const TARGET = "0.4.0";

/**
 * v0.3.0 → v0.4.0 — v0.4 autonomous goal engine.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §9. Non-destructive workspace
 * upgrade:
 *
 *   - Per-org `<org>/goals/` directory (empty initially)
 *   - Workspace-root `AGENTS.md` (canonical persistent guide). If a
 *     CLAUDE.md already exists at the same level, its content is copied
 *     into AGENTS.md (1-time merge) and the original CLAUDE.md is left
 *     untouched. SoloSquad no longer manages CLAUDE.md after this point.
 *   - `workspace.yaml` gains a `goal:` section with defaults
 *   - Version bump 0.3.0 → 0.4.0
 *
 * Per v0.4 §4.2 decision (2026-05-13 오후): the single workspace
 * persistent guide is AGENTS.md. CLAUDE.md is not generated or
 * maintained going forward.
 */
export const migration: Migration = {
  from: "0.3.0",
  to: TARGET,
  description:
    "v0.4 autonomous engine: per-org goals/, workspace AGENTS.md (canonical), goal: config section.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return ws.version === "0.3.0";
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);

    for (const o of orgs) {
      const goalsDir = path.join(o.path, "goals");
      if (!fs.existsSync(goalsDir)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/goals/`,
          description: `Create autonomous-goal store dir for ${o.slug}`,
        });
      }
    }

    const agentsMd = path.join(workspace, "AGENTS.md");
    const claudeMd = path.join(workspace, "CLAUDE.md");
    if (!fs.existsSync(agentsMd)) {
      if (fs.existsSync(claudeMd)) {
        steps.push({
          kind: "generate",
          to: "AGENTS.md",
          description:
            "Create workspace AGENTS.md (canonical persistent guide). Existing CLAUDE.md content will be copied in once; original file left untouched.",
        });
      } else {
        steps.push({
          kind: "generate",
          to: "AGENTS.md",
          description: "Create workspace AGENTS.md from template (no prior CLAUDE.md).",
        });
      }
    } else {
      steps.push({
        kind: "update",
        to: "AGENTS.md",
        description:
          "AGENTS.md already exists — only append v0.4 'SoloSquad Autonomous Goal Conventions' section if missing.",
      });
    }

    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: "Add goal section with defaults (default_hours: 8, default_budget_usd: 5)",
    });
    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: `Bump version: 0.3.0 → ${TARGET}`,
    });
    steps.push({
      kind: "note",
      description:
        "v0.4 autonomous engine introduces `solosquad goal new / run / status / verify / stop / list / show`. " +
        "AGENTS.md is the canonical persistent guide — human-edited only, no AI tool modifies it. " +
        "If you had a CLAUDE.md before, it is left in place but SoloSquad no longer reads it.",
    });

    return {
      steps,
      warnings: [
        "After migration, restart `solosquad bot` so v0.4 modules are loaded.",
        "Edit AGENTS.md to customize immutable_paths and external HTTP whitelist for autonomous runs.",
        "First autonomous goal: `solosquad goal new <goal-id>` then edit goal.md.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0.01,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const orgs = listOrganizations(workspace);

    for (const o of orgs) {
      const goalsDir = path.join(o.path, "goals");
      fs.mkdirSync(goalsDir, { recursive: true });
      const keep = path.join(goalsDir, ".gitkeep");
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, "", "utf-8");
    }

    const agentsMd = path.join(workspace, "AGENTS.md");
    const claudeMd = path.join(workspace, "CLAUDE.md");
    const templatePath = path.join(getAssetsDir(), "templates", "AGENTS.md");
    const v04Section = extractV04Section(templatePath);

    if (!fs.existsSync(agentsMd)) {
      let body: string;
      if (fs.existsSync(claudeMd)) {
        const claude = fs.readFileSync(claudeMd, "utf-8");
        body =
          "# AGENTS.md\n\n" +
          "> **Canonical workspace guide.** All AI tools (SoloSquad, Codex, Aider, " +
          "Cursor, modern Claude Code) read this file. **Human-edited only.**\n\n" +
          "> This file was migrated from the previous CLAUDE.md at v0.4.0 (v0.4) " +
          "release. The original CLAUDE.md is left in place but SoloSquad no " +
          "longer reads it. You may delete it if unused.\n\n" +
          "---\n\n" +
          stripLeadingH1(claude) +
          "\n\n" +
          v04Section;
      } else if (fs.existsSync(templatePath)) {
        body = fs.readFileSync(templatePath, "utf-8");
      } else {
        body =
          "# AGENTS.md\n\n> Canonical workspace guide. Human-edited only.\n\n" +
          v04Section;
      }
      fs.writeFileSync(agentsMd, body, "utf-8");
    } else {
      const existing = fs.readFileSync(agentsMd, "utf-8");
      if (!/SoloSquad v0\.4 — Autonomous Goal Conventions/i.test(existing)) {
        fs.appendFileSync(agentsMd, "\n\n" + v04Section + "\n", "utf-8");
      }
    }

    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      const yamlDoc = ws;
      if (!ws.goal) {
        ws.goal = {
          default_hours: 8,
          default_budget_usd: 5,
          dedicated_session_prefix: "bg-",
        };
      }
      void yamlDoc;
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
    if (!ws.goal) {
      return { ok: false, error: "workspace.yaml.goal section missing after migration" };
    }

    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      const goalsDir = path.join(o.path, "goals");
      if (!fs.existsSync(goalsDir)) {
        return { ok: false, error: `${o.slug}/goals/ missing after migration` };
      }
    }

    const agentsMd = path.join(workspace, "AGENTS.md");
    if (!fs.existsSync(agentsMd)) {
      return { ok: false, error: "workspace AGENTS.md missing after migration" };
    }
    const body = fs.readFileSync(agentsMd, "utf-8");
    if (!/SoloSquad v0\.4 — Autonomous Goal Conventions/i.test(body)) {
      return {
        ok: false,
        error: "AGENTS.md lacks v0.4 Autonomous Goal Conventions section",
      };
    }
    return { ok: true };
  },
};

// ---------- helpers ----------

function extractV04Section(templatePath: string): string {
  if (!fs.existsSync(templatePath)) {
    return "## SoloSquad v0.4 — Autonomous Goal Conventions\n\n(template missing — refer to docs/plan/v0.4-autonomous-engine.md §4.2)";
  }
  const body = fs.readFileSync(templatePath, "utf-8");
  const idx = body.indexOf("## SoloSquad v0.4");
  if (idx < 0) return body;
  return body.slice(idx).trim();
}

function stripLeadingH1(s: string): string {
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ")) {
      return lines.slice(i + 1).join("\n").trimStart();
    }
    if (lines[i].trim() !== "") return s;
  }
  return s;
}
