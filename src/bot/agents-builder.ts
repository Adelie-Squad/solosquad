import fs from "fs";
import path from "path";
import { getAgentsDir, getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v1.2.5 — `.claude/agents/` synchronizer.
 *
 * Claude Code discovers custom subagents from `<cwd>/.claude/agents/<name>.md`.
 * SoloSquad ships agent SKILL.md files at `assets/agents/{team}/{agent}/SKILL.md`
 * (`<workspace>/.solosquad/agents/...` after init). This module mirrors them
 * into `<org>/.claude/agents/<agent>.md` with the YAML frontmatter Claude Code
 * expects (`name`, `description`, optional `tools`, `model`).
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §3.3 + PoC #1 finding (filesystem
 * discovery beats inline `--agents` JSON because 25 × 5KB SKILLs blow past the
 * Windows CMD 8191-char argv limit).
 *
 * Triggered by: `solosquad init`, `solosquad sync`, migration 1.2.4 -> 1.2.5.
 */

interface TeamDefaults {
  tools: string[];
  model: "opus" | "sonnet" | "haiku";
}

/** Per-team default tool allowlist + model. */
const TEAM_DEFAULTS: Record<string, TeamDefaults> = {
  strategy: {
    tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "Write"],
    model: "sonnet",
  },
  growth: {
    tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "Write"],
    model: "sonnet",
  },
  experience: {
    tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "Write"],
    model: "sonnet",
  },
  engineering: {
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch"],
    model: "opus",
  },
};

/** Per-agent overrides (only where defaults are noticeably wrong). */
const AGENT_OVERRIDES: Record<string, Partial<TeamDefaults>> = {
  "data-collector": { tools: ["Read", "Write", "Bash", "WebFetch", "WebSearch", "Grep"] },
  "cloud-admin": { tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"] },
  "security-engineer": { tools: ["Read", "Grep", "Glob", "Bash"] },
  "qa-engineer": { tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"] },
  architect: { model: "sonnet" },
  "scope-estimator": { model: "haiku" },
  "idea-refiner": { model: "haiku" },
};

export interface BuiltAgent {
  team: string;
  name: string;
  path: string;
  description: string;
  tools: string[];
  model: string;
}

export function listSourceAgents(agentsDir: string = getAgentsDir()): Array<{
  team: string;
  agent: string;
  skillPath: string;
}> {
  const out: Array<{ team: string; agent: string; skillPath: string }> = [];
  if (!fs.existsSync(agentsDir)) return out;
  for (const teamEntry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith("_")) continue; // skip _teams/
    const teamPath = path.join(agentsDir, teamEntry.name);
    for (const agentEntry of fs.readdirSync(teamPath, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamPath, agentEntry.name, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        out.push({
          team: teamEntry.name,
          agent: agentEntry.name,
          skillPath,
        });
      }
    }
  }
  return out;
}

export function extractDescription(skillBody: string): string {
  const normalized = normalizeLine(skillBody);
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("> ")) return line.slice(2).trim();
  }
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    return t.slice(0, 200);
  }
  return "SoloSquad specialist agent";
}

export function buildAgentFile(team: string, agent: string, skillSrc: string): string {
  const description = extractDescription(skillSrc);
  const teamDef = TEAM_DEFAULTS[team] ?? TEAM_DEFAULTS.engineering;
  const override = AGENT_OVERRIDES[agent] ?? {};
  const tools = override.tools ?? teamDef.tools;
  const model = override.model ?? teamDef.model;

  const frontmatter = [
    "---",
    `name: ${agent}`,
    `description: ${escapeYamlScalar(description)}`,
    `tools: [${tools.join(", ")}]`,
    `model: ${model}`,
    `team: ${team}`,
    "---",
    "",
  ].join("\n");

  // Add a blank line between frontmatter and body for readability.
  return frontmatter + "\n" + normalizeLine(skillSrc) + "\n";
}

function escapeYamlScalar(s: string): string {
  if (/[:#]|^[\s-]/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function syncAgentsToOrg(
  workspace: string,
  orgSlug: string,
  agentsDir?: string
): BuiltAgent[] {
  const sources = listSourceAgents(agentsDir);
  const targetDir = path.join(getOrgDir(orgSlug, workspace), ".claude", "agents");
  fs.mkdirSync(targetDir, { recursive: true });

  const built: BuiltAgent[] = [];
  for (const { team, agent, skillPath } of sources) {
    const src = fs.readFileSync(skillPath, "utf-8");
    const content = buildAgentFile(team, agent, src);
    const dest = path.join(targetDir, `${agent}.md`);
    fs.writeFileSync(dest, content, "utf-8");

    const teamDef = TEAM_DEFAULTS[team] ?? TEAM_DEFAULTS.engineering;
    const override = AGENT_OVERRIDES[agent] ?? {};
    built.push({
      team,
      name: agent,
      path: dest,
      description: extractDescription(src),
      tools: override.tools ?? teamDef.tools,
      model: override.model ?? teamDef.model,
    });
  }
  return built;
}

export function pruneOrphanAgents(
  workspace: string,
  orgSlug: string,
  validNames: Set<string>
): string[] {
  const targetDir = path.join(getOrgDir(orgSlug, workspace), ".claude", "agents");
  if (!fs.existsSync(targetDir)) return [];
  const removed: string[] = [];
  for (const f of fs.readdirSync(targetDir)) {
    if (!f.endsWith(".md")) continue;
    const name = f.slice(0, -3);
    if (!validNames.has(name)) {
      fs.unlinkSync(path.join(targetDir, f));
      removed.push(name);
    }
  }
  return removed;
}
