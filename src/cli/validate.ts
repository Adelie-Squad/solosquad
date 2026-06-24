import chalk from "chalk";

/**
 * v1.3.6 §3.6 / §6.4 — `solosquad validate [kind]`: the cross-kind static gate.
 *
 * The unified `asset` front door is being retired: every `asset <verb> <kind>`
 * was a duplicate of the per-kind group (`asset list skill` == `skill list`),
 * and the *only* value unique to a front door is cross-kind work — which here
 * is whole-bundle validation. So that one capability is promoted to a top-level,
 * noun-free command (the CI gate); discovery stays with `solosquad commands`.
 *
 * Kind omitted = validate everything (skill+agent graph, workflow, goal, cron).
 * Thin façade: delegates to each per-domain validate so there is one impl.
 */

export type AssetKind = "skill" | "agent" | "workflow" | "goal" | "cron";
const KINDS: AssetKind[] = ["skill", "agent", "workflow", "goal", "cron"];

function isKind(s: string | undefined): s is AssetKind {
  return !!s && (KINDS as string[]).includes(s);
}

export async function validateAllCommand(kind: string | undefined): Promise<void> {
  if (kind && !isKind(kind)) {
    console.error(chalk.red(`error: kind must be one of: ${KINDS.join(", ")} (got "${kind}")`));
    process.exitCode = 2;
    return;
  }
  const kinds = kind ? [kind as AssetKind] : KINDS;

  // `agent validate --all` is the shared static gate for skill AND agent (it
  // validates every bundled SKILL.md + the cross-agent graph) — run it once.
  const runners: Array<[string, () => Promise<void>]> = [];
  if (kinds.includes("skill") || kinds.includes("agent")) {
    runners.push([
      "skill+agent",
      async () => (await import("./agent.js")).agentValidateCommand(undefined, { all: true }),
    ]);
  }
  if (kinds.includes("workflow")) {
    runners.push([
      "workflow",
      async () => (await import("./workflow.js")).workflowValidateCommand(undefined, { all: true }),
    ]);
  }
  if (kinds.includes("goal")) {
    runners.push([
      "goal",
      async () => (await import("./goal.js")).goalValidateCommand(undefined, { all: true }),
    ]);
  }
  if (kinds.includes("cron")) {
    runners.push(["cron", async () => (await import("./cron.js")).cronValidateCommand()]);
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
