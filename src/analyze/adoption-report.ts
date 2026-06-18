import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { scanRepoAssets, type AssetKind, type ScannedAsset } from "./asset-scanner.js";
import { parseSkillMd, validateSkill, SkillParseError } from "../bot/skill-parser.js";
import { validateWorkflow } from "../bot/workflow-validate.js";
import { validateScheduleDef } from "../scheduler/schedule-validate.js";
import { coerceScheduleDef } from "../scheduler/schedule-def.js";
import { loadAgentSpecs, agentRefAliases } from "../bot/agent-spec.js";
import { mapAgentToTaxonomy, type AgentMapping } from "./agent-map.js";
import { listSourceAgents } from "../bot/agents-builder.js";
import { ROUTINES } from "../scheduler/routines.js";
import { getSkillsDir, getAgentsDir } from "../util/paths.js";

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
  for (const a of scanRepoAssets(getSkillsDir(), { maxFiles: 10_000 })) {
    if (a.kind === "skill") ids.add(a.id);
  }
  return ids;
}

function bundledIds(): Record<AssetKind, Set<string>> {
  const agents = new Set(loadAgentSpecs().map((s) => s.name));
  // also accept the flat-bucket layout for safety
  for (const { agent } of listSourceAgents(getAgentsDir())) agents.add(agent);
  const workflows = new Set<string>();
  for (const a of scanRepoAssets(getSkillsDir(), { maxFiles: 10_000 })) {
    if (a.kind === "workflow") workflows.add(a.id);
  }
  return {
    skill: bundledSkillIds(),
    agent: agents,
    workflow: workflows,
    schedule: new Set(ROUTINES.map((r) => r.id)),
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
    if (asset.kind === "schedule") {
      const raw = yaml.load(fs.readFileSync(full, "utf-8"));
      const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const def = coerceScheduleDef(obj, asset.id);
      const promptExists = (id: string): boolean =>
        fs.existsSync(path.join(path.dirname(full), `${id}.md`));
      const r = validateScheduleDef(def, { promptExists });
      return finalize(r.errors, r.warnings);
    }
    // agent — graph validation needs team/tier mapping (§10.3) first
    return { status: "deferred", findings: [{ code: "AGENT_MAP_PENDING", message: "team/tier mapping (§10.3) precedes graph validation" }] };
  } catch (e) {
    const msg = e instanceof SkillParseError ? e.message : (e as Error).message;
    return { status: "error", findings: [{ code: "PARSE_ERROR", message: msg }] };
  }
}

export function buildAdoptionReport(repoRoot: string): AdoptionReport {
  const assets = scanRepoAssets(repoRoot);
  const bundled = bundledIds();
  const knownAgents = new Set(agentRefAliases(loadAgentSpecs()));
  // discovered agents are also valid ref targets for discovered workflows
  for (const a of assets) if (a.kind === "agent") knownAgents.add(a.id);

  const counts: Record<AssetKind, number> = { skill: 0, agent: 0, workflow: 0, schedule: 0 };
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
