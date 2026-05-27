/**
 * Team composition loader (v1.1).
 *
 * Per v1.1 PRD §4.3, team membership is data — not folder structure.
 * `teams/<team>/composition.yaml` declares which specialists belong to
 * which team, plus shared skills the team's main bot can leader-tier call
 * directly. Specialists themselves live flat at `agents/specialists/<name>/`.
 *
 * Workspace layout:
 *   teams/<team>/composition.yaml          (bundled default)
 *   <org>/teams/<team>/composition.yaml    (optional override)
 *
 * Resolution order: org override > workspace bundle. If neither exists,
 * returns null so callers can decide whether to error or fall back.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const requireFromModule = createRequire(import.meta.url);
let yamlLib: typeof import("js-yaml") | undefined;
function loadYamlLib(): typeof import("js-yaml") {
  if (!yamlLib) {
    yamlLib = requireFromModule("js-yaml") as typeof import("js-yaml");
  }
  return yamlLib;
}

export const KNOWN_TEAMS = [
  "product",
  "engineering",
  "design",
  "marketing",
] as const;

export type TeamName = (typeof KNOWN_TEAMS)[number];

export interface Composition {
  /** Main bot name (e.g. "pm", "engineer", "designer", "marketer"). */
  main: string;
  /** Specialist names that belong to this team. */
  members: string[];
  /** Skill names the team's main bot can call directly (leader tier). */
  shared_skills: string[];
  /** Specialists from other teams allowed for cross-team collaboration. */
  cross_team_members?: string[];
}

export interface LoadOptions {
  /** Workspace bundle root (where `teams/` lives). */
  workspaceRoot: string;
  /** Optional org root (where `<org>/teams/` lives for overrides). */
  orgRoot?: string;
}

function compositionPath(root: string, team: TeamName): string {
  return path.join(root, "teams", team, "composition.yaml");
}

function readYaml(filePath: string): Composition | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = loadYamlLib().load(raw) as Partial<Composition> | undefined;
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.main !== "string" || parsed.main.length === 0) return null;
  if (!Array.isArray(parsed.members)) return null;
  return {
    main: parsed.main,
    members: parsed.members.filter((m): m is string => typeof m === "string"),
    shared_skills: Array.isArray(parsed.shared_skills)
      ? parsed.shared_skills.filter((s): s is string => typeof s === "string")
      : [],
    cross_team_members: Array.isArray(parsed.cross_team_members)
      ? parsed.cross_team_members.filter(
          (s): s is string => typeof s === "string"
        )
      : undefined,
  };
}

/**
 * Load a single team's composition. Org override beats workspace bundle.
 * Returns null if neither file exists or content is malformed.
 */
export function loadComposition(
  team: TeamName,
  opts: LoadOptions
): Composition | null {
  if (opts.orgRoot) {
    const override = readYaml(compositionPath(opts.orgRoot, team));
    if (override) return override;
  }
  return readYaml(compositionPath(opts.workspaceRoot, team));
}

/**
 * Load all four known teams. Returns a partial map — teams missing from
 * disk are simply absent. Callers needing strict presence should iterate
 * KNOWN_TEAMS and check.
 */
export function loadAllCompositions(
  opts: LoadOptions
): Partial<Record<TeamName, Composition>> {
  const out: Partial<Record<TeamName, Composition>> = {};
  for (const team of KNOWN_TEAMS) {
    const c = loadComposition(team, opts);
    if (c) out[team] = c;
  }
  return out;
}

/**
 * Reverse lookup: given a specialist name, return the team it belongs to.
 * Returns null if no team claims this specialist (orphan or unknown).
 * Resolution order: explicit `members` first, then `cross_team_members`.
 */
export function findTeamForMember(
  specialistName: string,
  opts: LoadOptions
): TeamName | null {
  const all = loadAllCompositions(opts);
  for (const team of KNOWN_TEAMS) {
    const c = all[team];
    if (!c) continue;
    if (c.members.includes(specialistName)) return team;
  }
  for (const team of KNOWN_TEAMS) {
    const c = all[team];
    if (!c?.cross_team_members) continue;
    if (c.cross_team_members.includes(specialistName)) return team;
  }
  return null;
}

/** True if `skill` is listed as a shared skill of any loaded team. */
export function isSharedSkill(
  skillName: string,
  opts: LoadOptions
): boolean {
  const all = loadAllCompositions(opts);
  for (const team of KNOWN_TEAMS) {
    const c = all[team];
    if (c?.shared_skills.includes(skillName)) return true;
  }
  return false;
}
