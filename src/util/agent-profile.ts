import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { getOrgDir, getSolosquadConfigDir } from "./paths.js";
import { normalizeLine } from "./platform.js";
import type { OnCapAction } from "../bot/author-budget.js";

/**
 * v0.6 §2.2 — Organization Layer Specialization (`agent-profile.yaml`).
 *
 * 25 specialist SKILL.md files stay immutable in the workspace; org-level
 * tone, priorities, and budget caps live in `<org>/agent-profile.yaml` as a
 * thin modifier (typically ~50 lines).
 *
 * Three-tier inheritance (P2 #11 — cross-org user defaults):
 *   1. workspace bundle defaults  (shipped, lowest priority)
 *   2. user global               (`~/.solosquad/agent-profile-defaults.yaml`)
 *   3. org agent-profile         (`<workspace>/<org>/agent-profile.yaml`)
 *
 * Same-keyed values: narrower scope wins (org > user > workspace).
 *
 * Budget invariant (security — §2.2 ¶3): agent-level overrides may only
 * *tighten* the parent defaults (smaller daily/weekly cap). A wider override
 * is rejected — we emit a warning and fall back to the parent value so a
 * single agent cannot escape the cross-agent ceiling.
 */

export const AGENT_PROFILE_SCHEMA_VERSION = 1;

export interface AgentBudget {
  daily_usd?: number;
  weekly_usd?: number;
  per_call_usd?: number;
  on_cap_action?: OnCapAction;
}

/**
 * Per-agent modifier — emission-side fields are intentionally loose
 * (`tone`, `priorities`, `voice`, `ban_phrases`, …) so org authors can add
 * new fields without a parser bump. Unknown keys flow through to the
 * spawn-assembler as raw yaml.
 */
export interface AgentSection {
  tone?: string;
  priorities?: string[];
  excluded_recommendations?: string[];
  voice?: string;
  ban_phrases?: string[];
  emphasis?: string;
  decision_frame?: string;
  budget?: AgentBudget;
  /** Free-form pass-through for forward compatibility. */
  [extra: string]: unknown;
}

export interface AgentProfileYaml {
  schema_version?: number;
  defaults?: AgentSection;
  /** Per-agent sections keyed by SKILL `name`. */
  [agentName: string]: AgentSection | number | undefined;
}

export interface AgentProfileMerged {
  defaults: AgentSection;
  agents: Record<string, AgentSection>;
  warnings: string[];
  /** Effective schema_version after merge — for diagnostics. */
  schemaVersion: number;
}

export interface LoadAgentProfileOpts {
  workspace: string;
  orgSlug: string;
  /** Override the user-global defaults path for tests. */
  userDefaultsPath?: string;
  /** Override the workspace bundle defaults path for tests. */
  workspaceDefaultsPath?: string;
}

const KNOWN_BUDGET_KEYS = new Set([
  "daily_usd",
  "weekly_usd",
  "per_call_usd",
  "on_cap_action",
]);

function readYamlIfExists(file: string): unknown | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    return yaml.load(normalizeLine(fs.readFileSync(file, "utf-8")));
  } catch {
    return undefined;
  }
}

function isAgentSection(value: unknown): value is AgentSection {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAgentProfileYaml(value: unknown): AgentProfileYaml | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as AgentProfileYaml;
}

/**
 * Merge two profiles (child overrides parent). Budget caps in the child are
 * *only* accepted if they are equal or narrower than the parent — looser
 * caps are dropped and a warning is collected.
 */
export function mergeProfiles(
  parent: AgentProfileMerged,
  child: AgentProfileYaml | undefined,
  childLabel: string,
): AgentProfileMerged {
  if (!child) return parent;

  const warnings = [...parent.warnings];
  const childDefaults = isAgentSection(child.defaults) ? child.defaults : {};
  const mergedDefaults = mergeSection(
    parent.defaults,
    childDefaults,
    `defaults (${childLabel})`,
    warnings,
  );

  // Per-agent sections are merged *against the just-merged defaults*. This
  // matters for the budget invariant: an agent override must be narrower
  // than the cross-agent defaults of the current scope, not the *parent's*
  // pre-merge defaults (which may be empty when this scope is the first one
  // to declare a budget).
  const agents: Record<string, AgentSection> = { ...parent.agents };
  for (const [key, raw] of Object.entries(child)) {
    if (key === "schema_version" || key === "defaults") continue;
    if (!isAgentSection(raw)) continue;
    const prior = agents[key] ?? mergedDefaults;
    agents[key] = mergeSection(prior, raw, `${key} (${childLabel})`, warnings);
  }

  const schemaVersion =
    typeof child.schema_version === "number" ? child.schema_version : parent.schemaVersion;

  return {
    defaults: mergedDefaults,
    agents,
    warnings,
    schemaVersion,
  };
}

function mergeSection(
  parent: AgentSection,
  child: AgentSection,
  label: string,
  warnings: string[],
): AgentSection {
  const out: AgentSection = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    if (key === "budget") continue;
    out[key] = value;
  }
  out.budget = mergeBudget(parent.budget, child.budget, label, warnings);
  return out;
}

function mergeBudget(
  parent: AgentBudget | undefined,
  child: AgentBudget | undefined,
  label: string,
  warnings: string[],
): AgentBudget | undefined {
  if (!parent && !child) return undefined;
  const merged: AgentBudget = { ...(parent ?? {}) };

  if (child) {
    for (const [key, value] of Object.entries(child)) {
      if (!KNOWN_BUDGET_KEYS.has(key)) continue;

      if (key === "on_cap_action") {
        merged.on_cap_action = (value as OnCapAction | undefined) ?? merged.on_cap_action;
        continue;
      }

      const childNum = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(childNum)) continue;

      const parentNum = parent
        ? (parent[key as keyof AgentBudget] as number | undefined)
        : undefined;

      // Narrower-only rule: child cap must be ≤ parent cap. A wider override
      // is silently downgraded to the parent value (with a warning) so a
      // single agent can't dodge the cross-agent ceiling.
      if (typeof parentNum === "number" && childNum > parentNum) {
        warnings.push(
          `agent-profile: ${label}.budget.${key}=${childNum} exceeds parent cap ${parentNum}; using parent value`,
        );
        merged[key as "daily_usd" | "weekly_usd" | "per_call_usd"] = parentNum;
      } else {
        merged[key as "daily_usd" | "weekly_usd" | "per_call_usd"] = childNum;
      }
    }
  }

  return merged;
}

/** Path to the user-global defaults file (cross-org cap inheritance). */
export function userGlobalDefaultsPath(): string {
  return path.join(os.homedir(), ".solosquad", "agent-profile-defaults.yaml");
}

/** Path to the org agent-profile.yaml. */
export function orgAgentProfilePath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "agent-profile.yaml");
}

/** Path to the bundled workspace defaults (ships in `.solosquad/`). */
export function workspaceBundleDefaultsPath(workspace: string): string {
  return path.join(getSolosquadConfigDir(workspace), "agent-profile-defaults.yaml");
}

/**
 * Load and merge in the 3-tier inheritance order.
 *
 * Missing files are graceful — a workspace with *no* agent-profile yields an
 * empty merged profile (defaults-only). schema_version is validated only
 * when at least one source file declares it; absence yields a warning (not
 * a refusal) so existing v0.5 workspaces don't break.
 */
export function loadAgentProfile(opts: LoadAgentProfileOpts): AgentProfileMerged {
  const warnings: string[] = [];

  const bundlePath = opts.workspaceDefaultsPath ?? workspaceBundleDefaultsPath(opts.workspace);
  const userPath = opts.userDefaultsPath ?? userGlobalDefaultsPath();
  const orgPath = orgAgentProfilePath(opts.workspace, opts.orgSlug);

  const bundleRaw = asAgentProfileYaml(readYamlIfExists(bundlePath));
  const userRaw = asAgentProfileYaml(readYamlIfExists(userPath));
  const orgRaw = asAgentProfileYaml(readYamlIfExists(orgPath));

  // schema_version sniff (P2 #12) — only enforce when at least one source
  // sets it. Mismatch → refuse load (return empty + warning).
  const declared = [
    { label: "bundle", v: bundleRaw?.schema_version, path: bundlePath },
    { label: "user", v: userRaw?.schema_version, path: userPath },
    { label: "org", v: orgRaw?.schema_version, path: orgPath },
  ].filter((d) => typeof d.v === "number");

  for (const d of declared) {
    if (d.v !== AGENT_PROFILE_SCHEMA_VERSION) {
      warnings.push(
        `agent-profile: ${d.label} schema_version=${d.v} is not supported (expected ${AGENT_PROFILE_SCHEMA_VERSION}) — refusing ${d.path}`,
      );
      return {
        defaults: {},
        agents: {},
        warnings,
        schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
      };
    }
  }

  // At least one file present but none declares schema_version — warn-only,
  // so first-run workspaces keep working without the migration touching them.
  const anyPresent = bundleRaw || userRaw || orgRaw;
  if (anyPresent && declared.length === 0) {
    warnings.push(
      `agent-profile: no schema_version declared — assuming ${AGENT_PROFILE_SCHEMA_VERSION}. Re-run \`solosquad migrate\` to add it.`,
    );
  }

  const empty: AgentProfileMerged = {
    defaults: {},
    agents: {},
    warnings,
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
  };

  const afterBundle = mergeProfiles(empty, bundleRaw, "workspace bundle");
  const afterUser = mergeProfiles(afterBundle, userRaw, "user global");
  const afterOrg = mergeProfiles(afterUser, orgRaw, `org ${opts.orgSlug}`);
  return afterOrg;
}

/** Resolve the effective budget for a specific agent (defaults + agent override). */
export function resolveAgentBudget(
  profile: AgentProfileMerged,
  agentName: string,
): AgentBudget | undefined {
  const agentSection = profile.agents[agentName];
  if (agentSection?.budget) return agentSection.budget;
  return profile.defaults.budget;
}
