import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { getAgentsDir } from "../util/paths.js";
import { listSourceAgents } from "./agents-builder.js";

/**
 * v1.3.2 §5 — the delegation-graph view of an agent (actor) definition.
 *
 * Distinct from `skill-parser`'s `SkillSpec`: that parser reads procedural
 * skill fields and (as of v1.3.2) does *not* parse the actor graph fields
 * (`tier`, `collaborators`, `used_by`, `skills_used`). This module extracts
 * exactly those so `validateAgents()` can build the orchestration topology.
 */

export interface AgentSpec {
  /** frontmatter `name` (falls back to the directory name). */
  name: string;
  /** "leader" | "member" (free string tolerated; validator flags unknowns). */
  tier?: string;
  /** frontmatter `team` (product/engineering/design/marketing/chief). */
  team: string;
  category?: string;
  devCapability?: boolean;
  /** outbound delegation/collaboration refs ("<team>/<name>" or bare name). */
  collaborators: string[];
  /** inbound refs — who uses this actor (bare name or "<team>/<name>"). */
  usedBy: string[];
  skillsUsed: string[];
  /** parent directory name — for the dir-match check. */
  dir: string;
  /** flat bucket the actor lives in: "main" | "specialists" | legacy team. */
  bucket: string;
  skillPath: string;
  /** canonical node id "<team>/<name>". */
  id: string;
}

function readFrontmatter(skillPath: string): Record<string, unknown> {
  try {
    const raw = normalizeLine(fs.readFileSync(skillPath, "utf-8"));
    if (!raw.startsWith("---")) return {};
    const end = raw.indexOf("\n---", 3);
    if (end < 0) return {};
    const parsed = yaml.load(raw.slice(3, end));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function strArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** Parse one SKILL.md (already located) into an AgentSpec. */
export function parseAgentSpec(
  skillPath: string,
  bucket: string,
  fallbackTeam: string,
): AgentSpec {
  const fm = readFrontmatter(skillPath);
  const dir = path.basename(path.dirname(skillPath));
  const name = typeof fm.name === "string" && fm.name.length > 0 ? fm.name : dir;
  const team = typeof fm.team === "string" && fm.team.length > 0 ? fm.team : fallbackTeam;
  return {
    name,
    tier: typeof fm.tier === "string" ? fm.tier : undefined,
    team,
    category: typeof fm.category === "string" ? fm.category : undefined,
    devCapability: typeof fm.dev_capability === "boolean" ? fm.dev_capability : undefined,
    collaborators: strArray(fm.collaborators),
    usedBy: strArray(fm.used_by),
    skillsUsed: strArray(fm.skills_used),
    dir,
    bucket,
    skillPath,
    id: `${team}/${name}`,
  };
}

/**
 * Load every actor under `agentsDir` (defaults to the bundled agents dir).
 * The caller assembles the validation scope — e.g. bundle + a single org's
 * adopted actors (v1.3.2 §10) — by concatenating multiple loads.
 */
export function loadAgentSpecs(agentsDir: string = getAgentsDir()): AgentSpec[] {
  return listSourceAgents(agentsDir).map(({ team, agent, skillPath }) => {
    const bucket = path.basename(path.dirname(path.dirname(skillPath)));
    return parseAgentSpec(skillPath, bucket, team || agent);
  });
}
