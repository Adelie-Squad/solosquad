import path from "path";
import fs from "fs";
import chalk from "chalk";
import { buildAdoptionReport, type AdoptionItem } from "../analyze/adoption-report.js";
import { applyAdoption } from "../analyze/adopt-apply.js";
import { getWorkspaceRoot, getAgentsDir, getSkillsDir, getSchedulesDir } from "../util/paths.js";

/**
 * v1.3.2 §10 — `solosquad adopt <repo>`. Currently dry-run only: scans the
 * repo, validates each asset (validate-then-adopt), and prints what *would* be
 * adopted + collisions. Actual writes (into the org layer, namespaced) are a
 * follow-up — the dry-run is the safe, confirm-first surface.
 */

export interface AdoptOpts {
  /** Reserved for the future write path; today every run is a dry-run. */
  apply?: boolean;
}

const KIND_EMOJI: Record<string, string> = {
  skill: "🔧",
  agent: "🤖",
  workflow: "🔗",
  schedule: "⏰",
};

function statusTag(item: AdoptionItem): string {
  switch (item.status) {
    case "ok":
      return chalk.green("✓");
    case "warn":
      return chalk.yellow("△");
    case "error":
      return chalk.red("✗");
    case "deferred":
      return chalk.dim("…");
  }
}

export async function adoptCommand(repoInput: string | undefined, opts: AdoptOpts): Promise<void> {
  if (!repoInput) {
    console.error(chalk.red("error: provide a repo path — `solosquad adopt <repo>`"));
    process.exitCode = 2;
    return;
  }
  const repoRoot = path.resolve(repoInput);
  if (!fs.existsSync(repoRoot)) {
    console.error(chalk.red(`error: repo path does not exist: ${repoRoot}`));
    process.exitCode = 2;
    return;
  }

  const report = buildAdoptionReport(repoRoot);
  const total = report.items.length;

  console.log(chalk.bold(`\nAdoption dry-run — ${repoRoot}`));
  console.log(
    chalk.dim(
      `discovered ${total} asset(s): ` +
        `skill=${report.counts.skill} agent=${report.counts.agent} ` +
        `workflow=${report.counts.workflow} schedule=${report.counts.schedule}\n`,
    ),
  );

  if (total === 0) {
    console.log(chalk.yellow("△ no first-class assets found (.claude/skills, .claude/agents, workflow.yaml, schedules/*.yaml)"));
    process.exitCode = 0;
    return;
  }

  for (const item of report.items) {
    const emoji = KIND_EMOJI[item.kind] ?? "•";
    const conflict = item.conflict ? chalk.magenta("  [collision → would namespace]") : "";
    const map = item.mapping
      ? chalk.blue(
          `  → ${item.mapping.team}/${item.mapping.tier}` +
            (item.mapping.confidence === "low" ? chalk.dim(" (low-confidence, review)") : ""),
        )
      : "";
    console.log(`${statusTag(item)} ${emoji} ${chalk.cyan(item.kind)}/${item.id}${map}${conflict}  ${chalk.dim(item.path)}`);
    for (const f of item.findings) {
      const c = item.status === "error" ? chalk.red : chalk.yellow;
      console.log(`     ${c(f.code)}: ${f.message}`);
    }
  }

  console.log();
  console.log(
    `${report.errorCount === 0 ? chalk.green("✓") : chalk.red("✗")} ` +
      `${report.errorCount} blocking error(s), ${report.conflictCount} collision(s)`,
  );

  if (!opts.apply) {
    console.log(chalk.dim("\nDry-run. Re-run with --apply to copy the valid assets into this workspace."));
    process.exitCode = report.errorCount === 0 ? 0 : 1;
    return;
  }

  // --apply — additive write into the workspace override dirs. Guard: must be an
  // initialized workspace (.solosquad exists) so we never write into the bundle.
  const ws = getWorkspaceRoot();
  if (!fs.existsSync(path.join(ws, ".solosquad"))) {
    console.error(chalk.red("\nerror: --apply needs an initialized workspace (.solosquad/). Run `solosquad init` first."));
    process.exitCode = 2;
    return;
  }

  const result = applyAdoption(repoRoot, report, {
    agentsDir: getAgentsDir(),
    skillsDir: getSkillsDir(),
    schedulesDir: getSchedulesDir(),
  });

  console.log(chalk.bold(`\nApplied (${result.writtenCount} written, ${result.skippedCount} skipped):`));
  for (const o of result.outcomes) {
    if (o.action === "skipped") {
      console.log(`  ${chalk.dim("∅")} ${o.kind}/${o.id} — ${chalk.dim(o.reason ?? "skipped")}`);
    } else {
      const ns = o.action === "namespaced" ? chalk.magenta(` (namespaced → ${o.finalId})`) : "";
      console.log(`  ${chalk.green("+")} ${o.kind}/${o.finalId}${ns}`);
    }
  }
  console.log(chalk.dim("\nRun `solosquad agent validate --graph` to re-check the graph after adoption."));
  process.exitCode = report.errorCount === 0 ? 0 : 1;
}
