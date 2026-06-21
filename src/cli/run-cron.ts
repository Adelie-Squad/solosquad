import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { runClaude } from "../bot/claude-runner.js";
import { loadProducts, loadEnv } from "../util/config.js";
import { getReposBase } from "../util/paths.js";
import { CRONS, loadCronPrompt, type CronConfig } from "../cron/crons.js";
import { loadCronDefs, resolveCronRef } from "../cron/cron-def.js";
import { saveCronMemory } from "../cron/memory.js";
import fs from "fs";

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

  const userDefs = loadCronDefs();
  const everything: CronConfig[] = [...CRONS, ...userDefs];

  let crons: CronConfig[];

  if (all) {
    // built-ins + enabled user crons
    crons = [...CRONS, ...userDefs.filter((d) => d.enabled)];
  } else if (cronRef) {
    const builtin = CRONS.find((r) => r.id === cronRef);
    if (builtin) {
      crons = [builtin];
    } else {
      const ref = resolveCronRef(cronRef);
      if (ref.kind === "ambiguous") {
        console.log(chalk.red(`"${cronRef}" is ambiguous — matches: ${ref.matches.join(", ")}. Use the exact id.`));
        process.exit(1);
      }
      const def = ref.kind === "ok" ? userDefs.find((d) => d.id === ref.id) : undefined;
      if (!def) {
        console.log(chalk.red(`Unknown cron: ${cronRef}`));
        console.log(chalk.dim(`Available: ${everything.map((r) => r.id).join(", ")}`));
        process.exit(1);
      }
      crons = [def];
    }
  } else {
    // Interactive select (built-ins + user crons, with enabled state)
    const { selected } = await inquirer.prompt([
      {
        name: "selected",
        message: "Select cron:",
        type: "list",
        choices: everything.map((r) => {
          const off = userDefs.some((d) => d.id === r.id && !d.enabled) ? chalk.dim(" [off]") : "";
          return { name: `${r.emoji} ${r.name} (${r.id})${off}`, value: r.id };
        }),
      },
    ]);
    crons = [everything.find((r) => r.id === selected)!];
  }

  const env = loadEnv();
  const reposBase = env.REPOS_BASE_PATH || getReposBase();

  for (const cron of crons) {
    for (const product of products) {
      const productDir = path.join(reposBase, product.slug);
      console.log(chalk.dim(`\n${cron.emoji} ${cron.name} — ${product.name}`));
      console.log(chalk.dim("Running Claude Code..."));

      const prompt = loadCronPrompt(cron.id);
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
