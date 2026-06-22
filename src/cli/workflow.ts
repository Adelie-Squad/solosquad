import chalk from "chalk";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getWorkspaceRoot, getSkillsDir, getBundledSkillsDir, getBundledAgentsDir, getOrgDir } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import {
  latestHandoffPath,
  listWorkflows,
  loadWorkflowSummary,
  prdPath,
  readEvents,
} from "../bot/workspace-meta.js";
import { validateWorkflow, type WorkflowFinding } from "../bot/workflow-validate.js";
import { loadAgentSpecs, agentRefAliases } from "../bot/agent-spec.js";

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pending: chalk.dim,
  in_progress: chalk.yellow,
  completed: chalk.green,
  needs_revision: chalk.red,
};

function statusColor(status: string): (s: string) => string {
  return STATUS_COLORS[status] ?? chalk.white;
}

/** `solosquad workflow list` — all workflows across orgs (or filter --org). */
export async function workflowListCommand(opts: { org?: string }): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws).filter((o) => !opts.org || o.slug === opts.org);
  if (orgs.length === 0) {
    console.log(chalk.dim("No organizations match the filter."));
    return;
  }

  for (const org of orgs) {
    const workflows = listWorkflows(ws, org.slug);
    console.log(chalk.cyan(`\n${org.slug}:`));
    if (workflows.length === 0) {
      console.log(chalk.dim("  (no workflows)"));
      continue;
    }
    for (const wf of workflows) {
      const counts = [
        wf.completedStages && chalk.green(`✓ ${wf.completedStages}`),
        wf.inProgressStages && chalk.yellow(`▶ ${wf.inProgressStages}`),
        wf.needsRevisionStages && chalk.red(`⚠ ${wf.needsRevisionStages}`),
        wf.pendingStages && chalk.dim(`○ ${wf.pendingStages}`),
      ]
        .filter(Boolean)
        .join("  ");
      const title = wf.title ? `  ${chalk.dim("—")} ${wf.title}` : "";
      const last = wf.lastEventTs ? chalk.dim(` last=${wf.lastEventTs.slice(0, 19)}`) : "";
      console.log(
        `  ${chalk.bold(wf.workflowId)}  [${counts || chalk.dim("(no stages)")}]${title}${last}`
      );
    }
  }
  console.log();
}

/** `solosquad workflow show <id>` — full details for one workflow. */
export async function workflowShowCommand(
  workflowId: string,
  opts: { org?: string; events?: number }
): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws).filter((o) => !opts.org || o.slug === opts.org);
  if (orgs.length === 0) {
    console.log(chalk.red("No matching organization."));
    process.exit(1);
  }

  let found = false;
  for (const org of orgs) {
    const wf = loadWorkflowSummary(ws, org.slug, workflowId);
    if (!wf) continue;
    found = true;
    console.log(chalk.bold(`\n${wf.workflowId}`) + chalk.dim(`  (${org.slug})`));
    if (wf.title) console.log(chalk.dim(`  ${wf.title}`));
    if (wf.createdAt) console.log(chalk.dim(`  created: ${wf.createdAt}`));
    console.log(chalk.dim(`  path: ${wf.path}`));

    console.log(chalk.bold(`\n  Stages (${wf.totalStages}):`));
    for (const stage of wf.stages) {
      const c = statusColor(stage.status);
      const dep = stage.depends_on?.length
        ? chalk.dim(`  ← ${stage.depends_on.join(", ")}`)
        : "";
      const repo = stage.target_repo ? chalk.dim(`  repo=${stage.target_repo}`) : "";
      console.log(
        `    ${c(stage.status.padEnd(15))} ${chalk.bold(stage.id)}  ${chalk.dim("agent=")}${stage.agent ?? "?"}${repo}${dep}`
      );
    }

    const prd = prdPath(ws, org.slug, workflowId);
    if (fs.existsSync(prd)) {
      console.log(chalk.bold("\n  PRD:"));
      console.log(chalk.dim(`    ${prd}`));
    }
    const handoff = latestHandoffPath(ws, org.slug, workflowId);
    if (handoff) {
      console.log(chalk.bold("  Latest handoff:"));
      console.log(chalk.dim(`    ${handoff}`));
    }

    const limit = opts.events ?? 8;
    const events = readEvents(ws, org.slug, workflowId);
    if (events.length > 0) {
      console.log(chalk.bold(`\n  Recent events (last ${Math.min(limit, events.length)} of ${events.length}):`));
      for (const e of events.slice(-limit)) {
        console.log(`    ${chalk.dim(e.ts.slice(0, 19))}  ${chalk.cyan(e.kind)}  ${shortPayload(e as unknown as Record<string, unknown>)}`);
      }
    }
    console.log();
    break;
  }

  if (!found) {
    console.log(chalk.red(`\nWorkflow not found: ${workflowId}`));
    process.exit(1);
  }
}

/**
 * `solosquad workflow validate [path] [--all]` — §6 validateWorkflow surface.
 * `--all` scans the bundled workflow-manager templates; agent refs resolve
 * against the actor registry.
 */
function bundledWorkflowFiles(): string[] {
  // Deterministic bundle scope — see getBundledSkillsDir. Avoids an ancestor
  // workspace's `.solosquad/skills` shadowing the shipped workflow templates.
  const dir = path.join(getBundledSkillsDir(), "workflow-manager", "assets", "workflows");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const f = path.join(dir, e.name, "workflow.yaml");
    if (fs.existsSync(f)) out.push(f);
  }
  return out;
}

/**
 * v1.3.5 §3.9 B-D4 — `solosquad workflow new <id> [--org]`: deterministic,
 * no-LLM scaffold of `<org>/workflows/<id>/workflow.yaml`, matching the uniform
 * asset floor (skill/agent/workflow/goal/cron all expose `new`). Authoring the
 * real stages from intent is a conversational job (Chief / workflow-manager
 * skill) — this only writes a valid 1-stage skeleton you edit afterward.
 */
export async function workflowNewCommand(
  id: string | undefined,
  opts: { org?: string } = {},
): Promise<void> {
  const { isKebabCase } = await import("../util/naming.js");
  if (!id || !isKebabCase(id)) {
    console.error(chalk.red("error: provide a kebab-case id — `solosquad workflow new <id>`"));
    process.exitCode = 2;
    return;
  }
  // Resolve the org (single → default; multiple → require --org).
  const orgs = listOrganizations();
  if (orgs.length === 0) {
    console.error(chalk.red("✗ no organizations — run `solosquad init` first."));
    process.exitCode = 1;
    return;
  }
  let orgSlug: string;
  if (opts.org) {
    if (!orgs.some((o) => o.slug === opts.org)) {
      console.error(chalk.red(`✗ no org "${opts.org}". Known: ${orgs.map((o) => o.slug).join(", ")}.`));
      process.exitCode = 1;
      return;
    }
    orgSlug = opts.org;
  } else if (orgs.length === 1) {
    orgSlug = orgs[0].slug;
  } else {
    console.error(chalk.red(`✗ multiple orgs — pass --org <slug> (${orgs.map((o) => o.slug).join(", ")}).`));
    process.exitCode = 2;
    return;
  }

  const dest = path.join(getOrgDir(orgSlug), "workflows", id, "workflow.yaml");
  if (fs.existsSync(dest)) {
    console.error(chalk.red(`✗ ${dest} already exists — edit it directly`));
    process.exitCode = 1;
    return;
  }

  // Pick a real actor for the skeleton stage so it validates out of the box.
  const known = agentRefAliases(loadAgentSpecs(getBundledAgentsDir()));
  const agentRef = known.has("product/pmf-planner")
    ? "product/pmf-planner"
    : [...known].find((r) => r.includes("/")) ?? "product/pmf-planner";

  const skeleton = {
    schema_version: 2,
    id,
    name: id,
    description: `TODO: describe the ${id} workflow`,
    stages: [
      {
        id: "stage-1",
        agent: agentRef,
        task: "TODO: describe what this stage does (inputs → outputs).",
        inputs: [],
        outputs: [],
        handoff_to: null,
      },
    ],
  };

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, yaml.dump(skeleton, { lineWidth: 100 }), "utf-8");
  console.log(chalk.green(`✓ scaffolded ${dest}  ${chalk.dim(`(org: ${orgSlug})`)}`));

  // Validate-then-trust: surface the skeleton's validation state immediately.
  const r = validateWorkflow(skeleton, { knownAgents: known });
  if (!r.ok) {
    console.log(chalk.red(`  ✗ ${r.errors.length} error(s):`));
    for (const e of r.errors) printWfIssue(e, "error");
    process.exitCode = 1;
  } else {
    console.log(chalk.dim("  Edit the stages, then `solosquad workflow validate <path>`."));
  }
}

export async function workflowValidateCommand(
  filePath: string | undefined,
  opts: { all?: boolean },
): Promise<void> {
  if (!filePath && !opts.all) {
    console.error(chalk.red("error: provide a path or use --all"));
    process.exitCode = 2;
    return;
  }

  const known = agentRefAliases(loadAgentSpecs(getBundledAgentsDir()));
  const files = filePath ? [path.resolve(filePath)] : bundledWorkflowFiles();
  let checked = 0;
  let failed = 0;

  for (const f of files) {
    checked++;
    if (!fs.existsSync(f)) {
      console.log(chalk.red(`✗ ${f} — not found`));
      failed++;
      continue;
    }
    let doc: unknown;
    try {
      doc = yaml.load(fs.readFileSync(f, "utf-8"));
    } catch (e) {
      console.log(chalk.red(`✗ ${f} — yaml error: ${(e as Error).message}`));
      failed++;
      continue;
    }
    const label = `${path.basename(path.dirname(f))}/workflow.yaml`;
    const r = validateWorkflow(doc, { knownAgents: known });
    if (r.ok && r.warnings.length === 0) {
      console.log(chalk.green(`✓ ${label}`));
      continue;
    }
    if (r.ok) {
      console.log(chalk.yellow(`△ ${label} — ${r.warnings.length} warning(s)`));
      for (const w of r.warnings) printWfIssue(w, "warn");
      continue;
    }
    failed++;
    console.log(chalk.red(`✗ ${label} — ${r.errors.length} error(s)`));
    for (const e of r.errors) printWfIssue(e, "error");
    for (const w of r.warnings) printWfIssue(w, "warn");
  }

  console.log();
  if (failed === 0) {
    console.log(chalk.green(`✓ ${checked} workflow(s) validated, 0 failed`));
    process.exitCode = 0;
  } else {
    console.log(chalk.red(`✗ ${failed} failed (of ${checked})`));
    process.exitCode = 1;
  }
}

function printWfIssue(issue: WorkflowFinding, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const where = issue.stage ? chalk.dim(` ${issue.stage}`) : "";
  console.log(`    ${tag} ${issue.code}${where}: ${issue.message}`);
}

function shortPayload(ev: Record<string, unknown>): string {
  const kind = ev.kind;
  const ignore = new Set(["ts", "kind"]);
  const out: string[] = [];
  for (const [k, v] of Object.entries(ev)) {
    if (ignore.has(k)) continue;
    if (typeof v === "string" && v.length > 60) {
      out.push(`${k}=${JSON.stringify(v.slice(0, 60) + "…")}`);
    } else {
      out.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  void kind;
  return out.join(" ");
}
