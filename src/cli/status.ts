import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadProducts, loadEnv } from "../util/config.js";
import { normalizeLine } from "../util/platform.js";
import { getReposBase } from "../util/paths.js";

function readLastJsonl(filePath: string, n = 3): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = normalizeLine(fs.readFileSync(filePath, "utf-8"))
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith('{"_schema'));

  const items: Record<string, unknown>[] = [];
  for (const line of lines.slice(-n)) {
    try {
      items.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return items;
}

function getProjectAge(projectDir: string): string {
  const brief = path.join(projectDir, "brief.md");
  if (!fs.existsSync(brief)) return chalk.dim("? no brief");
  const mtime = fs.statSync(brief).mtimeMs;
  const daysAgo = Math.floor((Date.now() - mtime) / 86_400_000);
  if (daysAgo === 0) return chalk.green("today");
  if (daysAgo <= 3) return chalk.yellow(`${daysAgo}d ago`);
  return chalk.dim(`${daysAgo}d ago`);
}

export function statusCommand(): void {
  const env = loadEnv();
  const reposBase = env.REPOS_BASE_PATH || getReposBase();

  console.log(
    chalk.bold.cyan("\n  Project Dashboard") +
    chalk.dim(`  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n`)
  );

  const products = loadProducts();
  if (!products.length) {
    console.log(chalk.red("No products registered. Run: solosquad init\n"));
    return;
  }

  for (const product of products) {
    const productDir = path.join(reposBase, product.slug);
    console.log(chalk.bold.white(`${product.name}`) + chalk.dim(` (${product.slug})`));

    // Projects
    const projectsDir = path.join(productDir, "projects");
    if (!fs.existsSync(projectsDir)) {
      console.log(chalk.dim("  No projects\n"));
      continue;
    }

    const projects = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    if (!projects.length) {
      console.log(chalk.dim("  No projects\n"));
      continue;
    }

    for (const proj of projects) {
      const projDir = path.join(projectsDir, proj.name);
      const age = getProjectAge(projDir);
      const decisions = readLastJsonl(path.join(projDir, "memory", "decisions.jsonl"), 1);
      const lastDecision = decisions.length
        ? String(decisions[0].decision || "-").slice(0, 40)
        : "-";

      console.log(`  ${chalk.cyan(proj.name.padEnd(24))} ${age.padEnd(16)} ${chalk.dim(lastDecision)}`);
    }

    // Hypotheses
    const hypFile = path.join(productDir, "memory", "hypotheses.jsonl");
    const hypotheses = readLastJsonl(hypFile, 5);
    const testing = hypotheses.filter((h) => h.status === "TESTING");
    if (testing.length) {
      console.log(chalk.yellow(`  Testing hypotheses: ${testing.length}`));
    }

    console.log();
  }

  console.log(chalk.dim("─────────────────────────────"));
  console.log(chalk.bold("Commands:"));
  console.log(`  ${chalk.cyan("solosquad bot")}        Start bot`);
  console.log(`  ${chalk.cyan("solosquad schedule")}   Start scheduler`);
  console.log(`  ${chalk.cyan("solosquad update")}     Check for updates`);
  console.log(`  ${chalk.cyan("solosquad doctor")}     Diagnose issues\n`);
}
