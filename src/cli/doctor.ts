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
import { getWorkspaceRoot } from "../util/paths.js";

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

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value.includes("your-") || value === "";
}

function tokenKeysForMessenger(messenger: string): string[] {
  const keys: string[] = [];
  if (messenger.includes("discord")) keys.push("DISCORD_TOKEN");
  if (messenger.includes("slack")) keys.push("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN");
  if (messenger.includes("telegram")) keys.push("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID");
  return keys;
}

export async function doctorCommand(ci?: boolean, messengerCheck?: boolean): Promise<void> {
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

  if (IS_WINDOWS) {
    if (!commandExists("pwsh")) {
      warn("PowerShell 7+", "winget install Microsoft.PowerShell");
    }
  }

  // 2. Workspace layout detection — v1.2.2 has .solosquad/, v1.1.x has flat config dirs
  console.log(chalk.dim("\nWorkspace layout:"));
  const workspace = getWorkspaceRoot();
  const solosquadDir = path.join(workspace, ".solosquad");
  const isNew = fs.existsSync(solosquadDir);
  const legacyMarkers = ["agents", "routines", "core"].every((d) =>
    fs.existsSync(path.join(workspace, d))
  );

  if (isNew) {
    check(`Workspace root: ${workspace}`, true);
    check(".solosquad/ present", true);
    const wsYaml = path.join(solosquadDir, "workspace.yaml");
    if (!check(".solosquad/workspace.yaml", fs.existsSync(wsYaml), "Run: solosquad init")) issues++;
  } else if (legacyMarkers) {
    warn(
      `Legacy v1.1.x layout at ${workspace}`,
      "Run: solosquad migrate --dry-run  (preview),  --apply  (upgrade to v1.2.2)"
    );
    issues++;
  } else {
    warn("No workspace detected here", "Run: solosquad init");
  }

  // 3. Configuration — reads process.env (post dotenv/config load in bin/solosquad.ts)
  console.log(chalk.dim("\nConfiguration:"));
  const envFile = isNew ? path.join(solosquadDir, ".env") : path.join(workspace, ".env");
  const envFileExists = fs.existsSync(envFile);
  if (!check(isNew ? ".solosquad/.env file" : ".env file", envFileExists, "Run: solosquad init")) issues++;

  // Detect .env vs process.env divergence — this catches the "dotenv not loaded" class of bug.
  const fileEnv = envFileExists ? loadEnv() : {};
  const divergent: string[] = [];
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] !== v) divergent.push(k);
  }
  if (envFileExists && divergent.length > 0) {
    warn(
      `.env vs process.env mismatch on: ${divergent.join(", ")}`,
      "dotenv not loaded? Ensure bin entry does `import \"dotenv/config\"`"
    );
  }

  const rawMessenger = (process.env.MESSENGER || "").trim();
  const messenger = rawMessenger.split(",")[0].trim();
  if (!check("MESSENGER set (process.env)", !!messenger, "Set MESSENGER in .env or shell")) {
    issues++;
  }
  if (rawMessenger.includes(",")) {
    warn(
      `MESSENGER contains multiple values: "${rawMessenger}"`,
      "v1.2.2 supports only one messenger per workspace. Using first value."
    );
  }

  if (messenger) {
    for (const key of tokenKeysForMessenger(messenger)) {
      const val = process.env[key];
      if (!check(key, !isPlaceholder(val), `Set a valid value (currently: ${val ? "placeholder" : "unset"})`)) {
        issues++;
      }
    }
  }

  if (!isNew) {
    const reposPath = process.env.REPOS_BASE_PATH || "";
    if (!check("REPOS_BASE_PATH exists", !!reposPath && fs.existsSync(reposPath), `Path: ${reposPath || "(unset)"}`)) {
      issues++;
    }
  }

  // 4. Project structure
  console.log(chalk.dim("\nProject structure:"));
  if (isNew) {
    if (!check(".solosquad/agents/", fs.existsSync(path.join(solosquadDir, "agents")), "Run: solosquad init")) issues++;
    if (!check(".solosquad/routines/", fs.existsSync(path.join(solosquadDir, "routines")), "Run: solosquad init")) issues++;
  } else {
    if (!check("core/products.json", fs.existsSync("core/products.json"), "Run: solosquad init")) issues++;
    if (!check("agents/", fs.existsSync("agents"), "Run: solosquad init")) issues++;
    if (!check("routines/", fs.existsSync("routines"), "Run: solosquad init")) issues++;
  }

  const products = loadProducts();
  const unitLabel = isNew ? "Organizations" : "Products";
  if (!check(`${unitLabel} registered (${products.length})`, products.length > 0, isNew ? "Run: solosquad add org <name>" : "Run: solosquad init")) issues++;

  // 4. Live messenger API check (opt-in)
  if (messengerCheck && messenger) {
    console.log(chalk.dim("\nMessenger API check:"));
    issues += await runMessengerChecks(messenger);
  }

  // 5. Summary
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

// -- Live API probes --

async function runMessengerChecks(messenger: string): Promise<number> {
  let failures = 0;
  if (messenger.includes("discord")) {
    if (!(await checkDiscord())) failures++;
  }
  if (messenger.includes("slack")) {
    if (!(await checkSlack())) failures++;
  }
  if (messenger.includes("telegram")) {
    if (!(await checkTelegram())) failures++;
  }
  return failures;
}

async function checkDiscord(): Promise<boolean> {
  const token = process.env.DISCORD_TOKEN;
  if (isPlaceholder(token)) {
    return check("Discord /users/@me", false, "DISCORD_TOKEN not set");
  }
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      return check("Discord /users/@me", false, `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { username?: string };
    return check(`Discord /users/@me → ${body.username ?? "(ok)"}`, true);
  } catch (e) {
    return check("Discord /users/@me", false, `${e}`);
  }
}

async function checkSlack(): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (isPlaceholder(token)) {
    return check("Slack auth.test", false, "SLACK_BOT_TOKEN not set");
  }
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; user?: string };
    if (!body.ok) {
      return check("Slack auth.test", false, body.error || "unknown");
    }
    return check(`Slack auth.test → ${body.user ?? "(ok)"}`, true);
  } catch (e) {
    return check("Slack auth.test", false, `${e}`);
  }
}

async function checkTelegram(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (isPlaceholder(token)) {
    return check("Telegram getMe", false, "TELEGRAM_BOT_TOKEN not set");
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = (await res.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!body.ok) {
      return check("Telegram getMe", false, body.description || "unknown");
    }
    return check(`Telegram getMe → @${body.result?.username ?? "(ok)"}`, true);
  } catch (e) {
    return check("Telegram getMe", false, `${e}`);
  }
}
