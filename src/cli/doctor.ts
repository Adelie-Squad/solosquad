import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadEnv, loadProducts } from "../util/config.js";
import {
  commandExists,
  IS_WINDOWS,
  platformInfo,
  shellName,
} from "../util/platform.js";

function check(label: string, ok: boolean, hint?: string): boolean {
  if (ok) {
    console.log(` ${chalk.green("✓")} ${label}`);
  } else {
    console.log(` ${chalk.red("✗")} ${label}${hint ? chalk.dim(` — ${hint}`) : ""}`);
  }
  return ok;
}

function warn(label: string, hint?: string): void {
  console.log(` ${chalk.yellow("△")} ${label}${hint ? chalk.dim(` — ${hint}`) : ""}`);
}

export async function doctorCommand(ci?: boolean): Promise<void> {
  console.log(chalk.bold("\nSoloSquad — Doctor\n"));
  console.log(chalk.dim(`Platform: ${platformInfo()}`));
  console.log(chalk.dim(`Shell: ${shellName()}\n`));

  let issues = 0;

  // 1. Runtime
  console.log(chalk.dim("Runtime:"));
  const nodeVer = parseInt(process.versions.node);
  if (!check("Node.js >= 18", nodeVer >= 18, `found v${process.versions.node}`)) issues++;

  const hasDocker = commandExists("docker");
  if (hasDocker) {
    check("Docker", true);
  } else {
    warn("Docker (optional)", "needed for isolated execution");
  }

  if (!check("git", commandExists("git"))) issues++;
  if (!check("Claude Code CLI", commandExists("claude"), "npm install -g @anthropic-ai/claude-code")) issues++;

  // Windows-specific checks
  if (IS_WINDOWS) {
    if (!commandExists("pwsh")) {
      warn("PowerShell 7+", "winget install Microsoft.PowerShell");
    }
  }

  // 2. Configuration
  console.log(chalk.dim("\nConfiguration:"));
  const envExists = fs.existsSync(".env");
  if (!check(".env file", envExists, "Run: solosquad init")) issues++;

  if (envExists) {
    const env = loadEnv();
    const messenger = env.MESSENGER || "discord";
    if (!check("MESSENGER set", !!env.MESSENGER, "Set MESSENGER in .env")) issues++;

    if (messenger.includes("discord")) {
      const hasToken = !!env.DISCORD_TOKEN && !env.DISCORD_TOKEN.includes("your-");
      if (!check("DISCORD_TOKEN", hasToken, "Set a valid Discord bot token")) issues++;
    }
    if (messenger.includes("slack")) {
      const hasBotToken = !!env.SLACK_BOT_TOKEN && !env.SLACK_BOT_TOKEN.includes("your-");
      const hasAppToken = !!env.SLACK_APP_TOKEN && !env.SLACK_APP_TOKEN.includes("your-");
      if (!check("SLACK_BOT_TOKEN", hasBotToken, "Set a valid Slack bot token")) issues++;
      if (!check("SLACK_APP_TOKEN", hasAppToken, "Set a valid Slack app token")) issues++;
    }
    if (messenger.includes("telegram")) {
      const hasToken = !!env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_BOT_TOKEN.includes("your-");
      if (!check("TELEGRAM_BOT_TOKEN", hasToken, "Set a valid Telegram bot token")) issues++;
      if (!check("TELEGRAM_CHAT_ID", !!env.TELEGRAM_CHAT_ID && env.TELEGRAM_CHAT_ID !== "your-chat-id")) issues++;
    }

    const reposPath = env.REPOS_BASE_PATH || "";
    if (!check("REPOS_BASE_PATH exists", !!reposPath && fs.existsSync(reposPath), `Path: ${reposPath}`)) issues++;
  }

  // 3. Project structure
  console.log(chalk.dim("\nProject structure:"));
  if (!check("core/products.json", fs.existsSync("core/products.json"), "Run: solosquad init")) issues++;
  if (!check("agents/", fs.existsSync("agents"), "Run: solosquad init")) issues++;
  if (!check("routines/", fs.existsSync("routines"), "Run: solosquad init")) issues++;

  const products = loadProducts();
  if (!check(`Products registered (${products.length})`, products.length > 0, "Run: solosquad init")) issues++;

  // 4. Summary
  console.log();
  if (issues === 0) {
    console.log(chalk.green.bold("✓ All checks passed. System is ready.\n"));
  } else {
    console.log(chalk.yellow(`⚠ ${issues} issue(s) found. Fix them and run again.\n`));
  }

  if (ci && issues > 0) {
    process.exit(1);
  }
}
