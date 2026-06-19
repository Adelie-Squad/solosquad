import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { runClaude } from "../bot/claude-runner.js";
import { loadProducts, loadEnv } from "../util/config.js";
import { getReposBase } from "../util/paths.js";
import { CRONS, loadCronPrompt } from "../scheduler/crons.js";
import { saveCronMemory } from "../scheduler/memory.js";
import fs from "fs";

export async function runCronCommand(
  cronId?: string,
  all?: boolean
): Promise<void> {
  const products = loadProducts();
  if (!products.length) {
    console.log(chalk.red("No products registered. Run: solosquad init"));
    process.exit(1);
  }

  let crons = CRONS;

  if (all) {
    // Run all
  } else if (cronId) {
    const found = CRONS.find((r) => r.id === cronId);
    if (!found) {
      console.log(chalk.red(`Unknown cron: ${cronId}`));
      console.log(chalk.dim(`Available: ${CRONS.map((r) => r.id).join(", ")}`));
      process.exit(1);
    }
    crons = [found];
  } else {
    // Interactive select
    const { selected } = await inquirer.prompt([
      {
        name: "selected",
        message: "Select cron:",
        type: "list",
        choices: CRONS.map((r) => ({
          name: `${r.emoji} ${r.name} (${r.id})`,
          value: r.id,
        })),
      },
    ]);
    crons = [CRONS.find((r) => r.id === selected)!];
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
