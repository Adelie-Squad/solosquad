import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { runClaude } from "../bot/claude-runner.js";
import { loadProducts, loadEnv, listOrganizations } from "../util/config.js";
import { getReposBase, getCronsWriteDir } from "../util/paths.js";
import { CRONS, loadCronPrompt, type CronConfig } from "../cron/crons.js";
import { loadCronDefs, resolveCronRef } from "../cron/cron-def.js";
import { saveCronMemory } from "../cron/memory.js";
import fs from "fs";

/** A cron to run + the org it belongs to. `orgSlug === undefined` = built-in
 *  (runs for every product); a slug = org-scoped user cron (v1.3.5 B-D3). */
interface CronJob {
  cron: CronConfig;
  orgSlug?: string;
}

/**
 * v1.3.3 §C — manual `cron run [ref]`. Runs a built-in OR a user-defined cron
 * (CronDef is a superset of CronConfig). An explicit ref runs even a *disabled*
 * user cron (so you can test before enabling); `--all` runs built-ins + only the
 * *enabled* user crons.
 */
export async function runCronCommand(
  cronRef?: string,
  all?: boolean
): Promise<void> {
  const products = loadProducts();
  if (!products.length) {
    console.log(chalk.red("No products registered. Run: solosquad init"));
    process.exit(1);
  }

  // v1.3.5 B-D3 — user crons are org-scoped; collect each org's defs tagged
  // with their org so they only run for that org (built-ins run for all).
  const userJobs: CronJob[] = listOrganizations().flatMap((o) =>
    loadCronDefs(getCronsWriteDir(o.slug)).map((def) => ({ cron: def as CronConfig, orgSlug: o.slug })),
  );
  const builtinJobs: CronJob[] = CRONS.map((cron) => ({ cron }));
  const everything: CronJob[] = [...builtinJobs, ...userJobs];

  let jobs: CronJob[];

  if (all) {
    // built-ins (all products) + enabled user crons (their own org)
    jobs = [...builtinJobs, ...userJobs.filter((j) => (j.cron as { enabled?: boolean }).enabled)];
  } else if (cronRef) {
    const builtin = builtinJobs.find((j) => j.cron.id === cronRef);
    if (builtin) {
      jobs = [builtin];
    } else {
      const match = userJobs.find((j) => j.cron.id === cronRef);
      // Fall back to ref resolution (name → id) within the matching org dirs.
      const refMatch = match
        ? match
        : userJobs.find((j) => {
            const r = resolveCronRef(cronRef, getCronsWriteDir(j.orgSlug!));
            return r.kind === "ok" && r.id === j.cron.id;
          });
      if (!refMatch) {
        console.log(chalk.red(`Unknown cron: ${cronRef}`));
        console.log(chalk.dim(`Available: ${everything.map((j) => j.cron.id).join(", ")}`));
        process.exit(1);
      }
      jobs = [refMatch];
    }
  } else {
    // Interactive select (built-ins + user crons, with org + enabled state)
    const { selected } = await inquirer.prompt([
      {
        name: "selected",
        message: "Select cron:",
        type: "list",
        choices: everything.map((j, i) => {
          const enabled = (j.cron as { enabled?: boolean }).enabled;
          const off = j.orgSlug && enabled === false ? chalk.dim(" [off]") : "";
          const orgTag = j.orgSlug ? chalk.dim(` @${j.orgSlug}`) : "";
          return { name: `${j.cron.emoji} ${j.cron.name} (${j.cron.id})${orgTag}${off}`, value: i };
        }),
      },
    ]);
    jobs = [everything[selected as number]];
  }

  const env = loadEnv();
  const reposBase = env.REPOS_BASE_PATH || getReposBase();

  for (const job of jobs) {
    // Built-in → every product; org-scoped user cron → only its org.
    const targets = job.orgSlug ? products.filter((p) => p.slug === job.orgSlug) : products;
    for (const product of targets) {
      const cron = job.cron;
      const productDir = path.join(reposBase, product.slug);
      console.log(chalk.dim(`\n${cron.emoji} ${cron.name} — ${product.name}`));
      console.log(chalk.dim("Running Claude Code..."));

      const prompt = loadCronPrompt(cron.id, job.orgSlug);
      const result = await runClaude(prompt, productDir, 180_000);

      // Save memory
      saveCronMemory(result, cron, productDir);

      // Save log
      const logDir = path.join(productDir, "memory", "cron-logs");
      fs.mkdirSync(logDir, { recursive: true });
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "-");
      const logFile = path.join(logDir, `${cron.id}-${timestamp}.md`);
      fs.writeFileSync(logFile, `# ${cron.name}\n\n${result}`);

      console.log(chalk.green(`✓ Done. Log saved: ${logFile}`));
      console.log(chalk.dim("─".repeat(40)));
      console.log(result.slice(0, 500));
      if (result.length > 500) console.log(chalk.dim(`\n... (${result.length} chars total)`));
    }
  }
}
