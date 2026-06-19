import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { scanRepoAssets, type AssetKind, type ScannedAsset } from "./asset-scanner.js";
import { parseSkillMd, validateSkill, SkillParseError } from "../bot/skill-parser.js";
import { validateWorkflow } from "../bot/workflow-validate.js";
import { validateCronDef } from "../scheduler/cron-validate.js";
import { coerceCronDef } from "../scheduler/cron-def.js";
import { loadAgentSpecs, agentRefAliases } from "../bot/agent-spec.js";
import { mapAgentToTaxonomy, mapAgentTeam, type AgentMapping, type AgentTeamCaller } from "./agent-map.js";
import { listSourceAgents } from "../bot/agents-builder.js";
import { CRONS } from "../scheduler/crons.js";
import { getBundledSkillsDir, getBundledAgentsDir } from "../util/paths.js";

/**
 * v1.3.2 §10.5 — adoption dry-run report. READ-ONLY: scans a registered repo
 * (§10.1 Discover), runs the matching validator on each asset
 * (validate-then-adopt, §10.6), and flags id collisions with the bundle
 * (§10.4 — adoption would namespace these). No writes; this is the "show what
 * would happen, then confirm" surface (Terraform plan / Claude "Will install").
 *
 * Agent assets are inventoried + conflict-checked but NOT graph-validated here:
 * their team/tier mapping (§10.3) precedes graph validation, and that mapping
 * is a later pipeline stage. So agents report status "deferred".
 */

export type ItemStatus = "ok" | "warn" | "error" | "deferred";

export interface AdoptionItem {
  kind: AssetKind;
  id: string;
  path: string;
  status: ItemStatus;
  conflict: boolean;
  findings: { code: string; message: string }[];
  /** §10.3 — for agents only: the proposed team/tier mapping. */
  mapping?: AgentMapping;
}

export interface AdoptionReport {
  repoRoot: string;
  items: AdoptionItem[];
  counts: Record<AssetKind, number>;
  errorCount: number;
  conflictCount: number;
}

function readAgentFrontmatter(
  full: string,
  fallbackId: string,
): { name: string; frontmatterTeam?: string; frontmatterTier?: string; description?: string } {
  try {
    const raw = fs.readFileSync(full, "utf-8");
    if (raw.startsWith("---")) {
      const end = raw.indexOf("\n---", 3);
      if (end > 0) {
        const fm = yaml.load(raw.slice(3, end));
        if (fm && typeof fm === "object" && !Array.isArray(fm)) {
          const o = fm as Record<string, unknown>;
          return {
            name: typeof o.name === "string" ? o.name : fallbackId,
            frontmatterTeam: typeof o.team === "string" ? o.team : undefined,
            frontmatterTier: typeof o.tier === "string" ? o.tier : undefined,
            description: typeof o.description === "string" ? o.description : undefined,
          };
        }
      }
    }
  } catch {
    // fall through to fallback
  }
  return { name: fallbackId };
}

function bundledSkillIds(): Set<string> {
  const ids = new Set<string>();
  for (const a of scanRepoAssets(getBundledSkillsDir(), { maxFiles: 10_000 })) {
    if (a.kind === "skill") ids.add(a.id);
  }
  return ids;
}

// §10.4 — the collision roster is the *shipped bundle*, resolved
// deterministically from the package root (getBundled*Dir), NOT the cwd-walked
// workspace. This is what keeps the dry-run identical on CI, on a dev machine
// whose checkout sits inside an unrelated workspace, and in a real install.
function bundledIds(): Record<AssetKind, Set<string>> {
  const agents = new Set(loadAgentSpecs(getBundledAgentsDir()).map((s) => s.name));
  // also accept the flat-bucket layout for safety
  for (const { agent } of listSourceAgents(getBundledAgentsDir())) agents.add(agent);
  const workflows = new Set<string>();
  for (const a of scanRepoAssets(getBundledSkillsDir(), { maxFiles: 10_000 })) {
    if (a.kind === "workflow") workflows.add(a.id);
  }
  return {
    skill: bundledSkillIds(),
    agent: agents,
    workflow: workflows,
    cron: new Set(CRONS.map((r) => r.id)),
  };
}

function validateOne(
  repoRoot: string,
  asset: ScannedAsset,
  knownAgents: Set<string>,
): { status: ItemStatus; findings: { code: string; message: string }[] } {
  const full = path.join(repoRoot, asset.path.split("/").join(path.sep));
  const finalize = (
    errs: { code: string; message: string }[],
    warns: { code: string; message: string }[],
  ): { status: ItemStatus; findings: { code: string; message: string }[] } => {
    if (errs.length) return { status: "error", findings: [...errs, ...warns] };
    if (warns.length) return { status: "warn", findings: warns };
    return { status: "ok", findings: [] };
  };

  try {
    if (asset.kind === "skill") {
      const spec = parseSkillMd(fs.readFileSync(full, "utf-8"), asset.path);
      const r = validateSkill(spec); // lenient: external skill, no strict_name
      return finalize(r.errors, r.warnings);
    }
    if (asset.kind === "workflow") {
      const doc = yaml.load(fs.readFileSync(full, "utf-8"));
      const r = validateWorkflow(doc, { knownAgents });
      return finalize(r.errors, r.warnings);
    }
    if (asset.kind === "cron") {
      const raw = yaml.load(fs.readFileSync(full, "utf-8"));
      const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const def = coerceCronDef(obj, asset.id);
      const promptExists = (id: string): boolean =>
        fs.existsSync(path.join(path.dirname(full), `${id}.md`));
      const r = validateCronDef(def, { promptExists });
      return finalize(r.errors, r.warnings);
    }
    // agent — graph validation needs team/tier mapping (§10.3) first
    return { status: "deferred", findings: [{ code: "AGENT_MAP_PENDING", message: "team/tier mapping (§10.3) precedes graph validation" }] };
  } catch (e) {
    const msg = e instanceof SkillParseError ? e.message : (e as Error).message;
    return { status: "error", findings: [{ code: "PARSE_ERROR", message: msg }] };
  }
}

/** §10 — optional scope overrides. Default resolution is the shipped bundle
 *  (deterministic, cwd-independent); callers may inject a wider/narrower set
 *  (e.g. bundle + the destination workspace's already-adopted actors). */
export interface AdoptionScopeOpts {
  /** Override the known-actor set used to resolve workflow `agent:` refs. */
  knownAgents?: Set<string>;
  /** Override the collision roster keyed by asset kind. */
  bundledIds?: Record<AssetKind, Set<string>>;
}

export function buildAdoptionReport(repoRoot: string, opts: AdoptionScopeOpts = {}): AdoptionReport {
  const assets = scanRepoAssets(repoRoot);
  const bundled = opts.bundledIds ?? bundledIds();
  const knownAgents = new Set(opts.knownAgents ?? agentRefAliases(loadAgentSpecs(getBundledAgentsDir())));
  // discovered agents are also valid ref targets for discovered workflows
  for (const a of assets) if (a.kind === "agent") knownAgents.add(a.id);

  const counts: Record<AssetKind, number> = { skill: 0, agent: 0, workflow: 0, cron: 0 };
  let errorCount = 0;
  let conflictCount = 0;
  const items: AdoptionItem[] = [];

  for (const a of assets) {
    counts[a.kind]++;
    const { status, findings } = validateOne(repoRoot, a, knownAgents);
    const conflict = bundled[a.kind].has(a.id);
    if (conflict) conflictCount++;
    if (status === "error") errorCount++;
    const mapping =
      a.kind === "agent"
        ? mapAgentToTaxonomy(readAgentFrontmatter(path.join(repoRoot, a.path.split("/").join(path.sep)), a.id))
        : undefined;
    items.push({ kind: a.kind, id: a.id, path: a.path, status, conflict, findings, mapping });
  }

  return { repoRoot, items, counts, errorCount, conflictCount };
}

/**
 * §10.3 — opt-in second pass: escalate the agents the heuristic left at
 * `default` (genuine ambiguity) to the injected LLM caller. Mutates the
 * report's agent items in place and returns it. Read-only otherwise; the
 * caller decides whether to consult a model (the dry-run never does). Agents
 * the heuristic already placed confidently are skipped, so the model is asked
 * at most once per unknown actor.
 */
export async function refineAgentMappings(
  report: AdoptionReport,
  caller: AgentTeamCaller,
): Promise<AdoptionReport> {
  for (const item of report.items) {
    if (item.kind !== "agent" || item.mapping?.source !== "default") continue;
    const fm = readAgentFrontmatter(
      path.join(report.repoRoot, item.path.split("/").join(path.sep)),
      item.id,
    );
    item.mapping = await mapAgentTeam(fm, { caller });
  }
  return report;
}
