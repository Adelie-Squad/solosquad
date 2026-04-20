import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { runClaude } from "../bot/claude-runner.js";
import { loadProducts, loadEnv } from "../util/config.js";
import { getReposBase } from "../util/paths.js";
import { ROUTINES, loadRoutinePrompt } from "../scheduler/routines.js";
import { saveRoutineMemory } from "../scheduler/memory.js";
import fs from "fs";

export async function runRoutineCommand(
  routineId?: string,
  all?: boolean
): Promise<void> {
  const products = loadProducts();
  if (!products.length) {
    console.log(chalk.red("No products registered. Run: solosquad init"));
    process.exit(1);
  }

  let routines = ROUTINES;

  if (all) {
    // Run all
  } else if (routineId) {
    const found = ROUTINES.find((r) => r.id === routineId);
    if (!found) {
      console.log(chalk.red(`Unknown routine: ${routineId}`));
      console.log(chalk.dim(`Available: ${ROUTINES.map((r) => r.id).join(", ")}`));
      process.exit(1);
    }
    routines = [found];
  } else {
    // Interactive select
    const { selected } = await inquirer.prompt([
      {
        name: "selected",
        message: "Select routine:",
        type: "list",
        choices: ROUTINES.map((r) => ({
          name: `${r.emoji} ${r.name} (${r.id})`,
          value: r.id,
        })),
      },
    ]);
    routines = [ROUTINES.find((r) => r.id === selected)!];
  }

  const env = loadEnv();
  const reposBase = env.REPOS_BASE_PATH || getReposBase();

  for (const routine of routines) {
    for (const product of products) {
      const productDir = path.join(reposBase, product.slug);
      console.log(chalk.dim(`\n${routine.emoji} ${routine.name} — ${product.name}`));
      console.log(chalk.dim("Running Claude Code..."));

      const prompt = loadRoutinePrompt(routine.id);
      const result = await runClaude(prompt, productDir, 180_000);

      // Save memory
      saveRoutineMemory(result, routine, productDir);

      // Save log
      const logDir = path.join(productDir, "memory", "routine-logs");
      fs.mkdirSync(logDir, { recursive: true });
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "-");
      const logFile = path.join(logDir, `${routine.id}-${timestamp}.md`);
      fs.writeFileSync(logFile, `# ${routine.name}\n\n${result}`);

      console.log(chalk.green(`✓ Done. Log saved: ${logFile}`));
      console.log(chalk.dim("─".repeat(40)));
      console.log(result.slice(0, 500));
      if (result.length > 500) console.log(chalk.dim(`\n... (${result.length} chars total)`));
    }
  }
}
