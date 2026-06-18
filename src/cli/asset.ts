import chalk from "chalk";

/**
 * v1.3.2 — `solosquad asset <verb> <kind>`: one front door over the
 * deterministic asset verbs (list / show / validate) that were previously
 * scattered across the per-domain groups. The domain groups still exist for
 * their domain-specific verbs (agent validate --graph, workflow focus,
 * goal run, schedules new); `asset` is the unified, discoverable entry the
 * "run one manager, distinguish by kind inside" model calls for. LLM verbs
 * (review/create) deliberately live in chat (skills/asset-review), not here.
 *
 * Thin façade: every verb delegates to the existing per-domain command so
 * there is exactly one implementation of each behavior.
 */

export type AssetKind = "skill" | "agent" | "workflow" | "schedule";
const KINDS: AssetKind[] = ["skill", "agent", "workflow", "schedule"];

function isKind(s: string | undefined): s is AssetKind {
  return !!s && (KINDS as string[]).includes(s);
}

function badKind(s: string | undefined): void {
  console.error(chalk.red(`error: kind must be one of: ${KINDS.join(", ")}${s ? ` (got "${s}")` : ""}`));
  process.exitCode = 2;
}

async function listSkills(): Promise<void> {
  const { getBundledSkillsDir } = await import("../util/paths.js");
  const { scanRepoAssets } = await import("../analyze/asset-scanner.js");
  const skills = scanRepoAssets(getBundledSkillsDir(), { maxFiles: 10_000 }).filter((a) => a.kind === "skill");
  console.log(chalk.bold(`${skills.length} skill(s)`));
  for (const s of skills.sort((a, b) => a.id.localeCompare(b.id))) console.log(`  ${chalk.cyan(s.id)}`);
}

export async function assetListCommand(kind: string | undefined): Promise<void> {
  if (kind && !isKind(kind)) return badKind(kind);
  const kinds = kind ? [kind as AssetKind] : KINDS;
  for (const k of kinds) {
    if (kinds.length > 1) console.log(chalk.bold.underline(`\n# ${k}`));
    if (k === "skill") await listSkills();
    else if (k === "agent") (await import("./agent.js")).agentListCommand({});
    else if (k === "workflow") await (await import("./workflow.js")).workflowListCommand({});
    else if (k === "schedule") await (await import("./schedule.js")).scheduleListCommand();
  }
}

export async function assetShowCommand(kind: string | undefined, id: string | undefined): Promise<void> {
  if (!isKind(kind)) return badKind(kind);
  if (!id) {
    console.error(chalk.red(`error: provide an id — \`solosquad asset show ${kind} <id>\``));
    process.exitCode = 2;
    return;
  }
  if (kind === "agent") await (await import("./agent.js")).agentShowCommand(id, {});
  else if (kind === "workflow") await (await import("./workflow.js")).workflowShowCommand(id, {});
  else if (kind === "schedule") await (await import("./schedule.js")).scheduleShowCommand(id);
  else {
    // skill — resolve the bundled SKILL.md path
    const path = await import("path");
    const fs = await import("fs");
    const { getBundledSkillsDir } = await import("../util/paths.js");
    const p = path.join(getBundledSkillsDir(), id, "SKILL.md");
    if (!fs.existsSync(p)) {
      console.error(chalk.red(`✗ no skill "${id}"`));
      process.exitCode = 1;
      return;
    }
    console.log(chalk.bold(`🔧 ${id}`));
    console.log(chalk.dim(`  ${p}`));
  }
}

export async function assetValidateCommand(kind: string | undefined): Promise<void> {
  if (kind && !isKind(kind)) return badKind(kind);
  const kinds = kind ? [kind as AssetKind] : KINDS;
  // `agent validate --all` is the shared static gate for skill AND agent (it
  // validates every bundled SKILL.md + the cross-agent graph) — run it once.
  const runners: Array<[string, () => Promise<void>]> = [];
  if (kinds.includes("skill") || kinds.includes("agent")) {
    runners.push(["skill+agent", async () => (await import("./agent.js")).agentValidateCommand(undefined, { all: true })]);
  }
  if (kinds.includes("workflow")) {
    runners.push(["workflow", async () => (await import("./workflow.js")).workflowValidateCommand(undefined, { all: true })]);
  }
  if (kinds.includes("schedule")) {
    runners.push(["schedule", async () => (await import("./schedule.js")).scheduleValidateCommand()]);
  }
  let anyFail = false;
  for (const [label, run] of runners) {
    if (runners.length > 1) console.log(chalk.bold.underline(`\n# ${label}`));
    process.exitCode = 0;
    await run();
    if (process.exitCode === 1) anyFail = true;
  }
  process.exitCode = anyFail ? 1 : 0;
}
