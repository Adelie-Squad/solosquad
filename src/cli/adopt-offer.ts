import fs from "fs";
import path from "path";
import chalk from "chalk";

/**
 * v1.3.2 §10.5 — interactive adoption offer, shared by `init` and `add repo`.
 *
 * After a repo is registered, surface its adoptable assets and (when the
 * terminal is interactive) walk the dry-run → confirm → apply flow inline, so
 * the user never has to remember the separate `solosquad adopt` command. In a
 * non-interactive context (CI, piped stdin) it degrades to the printed hint and
 * never blocks on a prompt. Apply only ever writes into an initialized
 * workspace (`.solosquad/`) — never the package bundle.
 */
export async function offerAdoption(repoPath: string, indent = ""): Promise<void> {
  let assets: { kind: string }[];
  try {
    const { scanRepoAssets } = await import("../analyze/asset-scanner.js");
    assets = scanRepoAssets(repoPath);
  } catch {
    return; // discovery is best-effort
  }
  if (assets.length === 0) return;

  const by = (k: string): number => assets.filter((a) => a.kind === k).length;
  console.log(
    chalk.cyan(
      `${indent}📦 Found ${assets.length} adoptable asset(s): ` +
        `skill=${by("skill")} agent=${by("agent")} workflow=${by("workflow")} cron=${by("cron")}`,
    ),
  );

  const hint = (): void => {
    console.log(chalk.dim(`${indent}  Review:  solosquad adopt ${repoPath}`));
    console.log(chalk.dim(`${indent}  Adopt:   solosquad adopt ${repoPath} --apply`));
  };

  // Non-interactive → hint only, never block on stdin.
  if (!process.stdin.isTTY) return hint();

  const inquirer = (await import("inquirer")).default;
  const { review } = await inquirer.prompt([
    { type: "confirm", name: "review", message: "Review these assets for adoption now?", default: true },
  ]);
  if (!review) return hint();

  const { buildAdoptionReport } = await import("../analyze/adoption-report.js");
  const report = buildAdoptionReport(repoPath);

  const tag = (s: string): string =>
    s === "error" ? chalk.red("✗") : s === "warn" ? chalk.yellow("△") : s === "deferred" ? chalk.dim("…") : chalk.green("✓");
  for (const item of report.items) {
    const conflict = item.conflict ? chalk.magenta("  [collision → namespaced]") : "";
    console.log(`${indent}  ${tag(item.status)} ${item.kind}/${item.id}${conflict}`);
  }
  console.log(
    `${indent}  ${report.errorCount === 0 ? chalk.green("✓") : chalk.red("✗")} ` +
      `${report.errorCount} blocking error(s), ${report.conflictCount} collision(s)`,
  );

  const adoptable = report.items.filter((i) => i.status !== "error").length;
  if (adoptable === 0) {
    console.log(chalk.yellow(`${indent}  nothing valid to adopt yet — fix the errors above, then \`solosquad adopt ${repoPath} --apply\``));
    return;
  }

  // Guard: apply writes into the workspace's `.solosquad/`, which only exists in
  // an initialized workspace. If there's none, fall back to the hint.
  const { getWorkspaceRoot } = await import("../util/paths.js");
  const dot = path.join(getWorkspaceRoot(), ".solosquad");
  if (!fs.existsSync(dot)) return hint();

  const { apply } = await inquirer.prompt([
    { type: "confirm", name: "apply", message: `Adopt ${adoptable} valid asset(s) into this workspace?`, default: false },
  ]);
  if (!apply) return hint();

  // Pin targets under `.solosquad/` (see adopt.ts) — never fall back to the bundle.
  const { applyAdoption } = await import("../analyze/adopt-apply.js");
  const result = applyAdoption(repoPath, report, {
    agentsDir: path.join(dot, "agents"),
    skillsDir: path.join(dot, "skills"),
    schedulesDir: path.join(dot, "crons"),
    workflowsDir: path.join(dot, "skills", "workflow-manager", "assets", "workflows"),
  });
  console.log(chalk.green(`${indent}✓ adopted ${result.writtenCount}, skipped ${result.skippedCount}`));
  for (const o of result.outcomes) {
    if (o.action === "namespaced") console.log(chalk.magenta(`${indent}  + ${o.kind}/${o.finalId} (namespaced from ${o.id})`));
  }
  console.log(chalk.dim(`${indent}  Re-check the graph: solosquad agent validate --graph`));
  // v1.3.7 §3.4B — adopted artifacts carry no rationale. Point the user at the
  // migration interview (creation_case:2) so the matching *-manager can analyze
  // the artifact, present a draft, and elicit the WHY/judgment the code omits.
  console.log(
    chalk.dim(
      `${indent}  Capture intent: ask Chief to run the matching manager — migration interview (analyze → draft → elicit the WHY not in the artifacts).`,
    ),
  );
}
