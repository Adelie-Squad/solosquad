import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import { getAssetsDir } from "../util/paths.js";
import { saveEnv, saveProducts, type Product } from "../util/config.js";
import { commandExists, defaultReposPath } from "../util/platform.js";

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

function checkCommand(cmd: string): boolean {
  return commandExists(cmd);
}

export async function initCommand(): Promise<void> {
  console.log(
    chalk.cyan.bold("\n  Solo Founder Agents") + " Setup Wizard\n" +
    chalk.dim("  Build a 24/7 AI assistant system tailored to your products.\n")
  );

  // Step 1: Environment check
  console.log(chalk.bold("-- Step 1: Environment Check --"));
  const checks = {
    Docker: checkCommand("docker"),
    "Node.js 18+": parseInt(process.versions.node) >= 18,
    git: checkCommand("git"),
    claude: checkCommand("claude"),
  };

  for (const [name, ok] of Object.entries(checks)) {
    console.log(` ${ok ? chalk.green("✓") : chalk.red("✗")} ${name}`);
  }

  if (!checks.Docker) {
    console.log(chalk.yellow("\n  Docker not found (optional). Some features like isolated execution require it."));
    console.log(chalk.dim("  Install: https://docs.docker.com/desktop/\n"));
  }

  // Step 2: Copy assets to workspace
  console.log(chalk.bold("\n-- Step 2: Initialize Workspace --"));
  const assetsDir = getAssetsDir();
  const workDir = process.cwd();

  const assetDirs = ["agents", "routines", "core", "templates", "orchestrator"];
  for (const dir of assetDirs) {
    const src = path.join(assetsDir, dir);
    if (fs.existsSync(src)) {
      copyDirSync(src, path.join(workDir, dir));
      console.log(` ${chalk.green("✓")} ${dir}/`);
    }
  }

  // Copy config files
  for (const file of [".env.example", "docker-compose.yml"]) {
    const src = path.join(assetsDir, file);
    const dest = path.join(workDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log(` ${chalk.green("✓")} ${file}`);
    }
  }

  // Create .env from example if needed
  if (!fs.existsSync(path.join(workDir, ".env"))) {
    const example = path.join(workDir, ".env.example");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, path.join(workDir, ".env"));
    }
  }

  // Step 3: Configuration
  console.log(chalk.bold("\n-- Step 3: Configuration --"));

  const { ownerName, ownerRole } = await inquirer.prompt([
    { name: "ownerName", message: "Your name:", type: "input" },
    { name: "ownerRole", message: "Your role (e.g. developer, designer, PM):", type: "input" },
  ]);

  const { messenger } = await inquirer.prompt([
    {
      name: "messenger",
      message: "Messenger platform:",
      type: "list",
      choices: [
        { name: "Discord  — Best for team channels", value: "discord" },
        { name: "Slack    — Great for workspace integration", value: "slack" },
        { name: "Telegram — Lightweight, mobile-friendly", value: "telegram" },
        { name: "Discord + Slack (multi-platform)", value: "discord,slack" },
      ],
    },
  ]);

  const envUpdates: Record<string, string> = {
    OWNER_NAME: ownerName,
    OWNER_ROLE: ownerRole,
    MESSENGER: messenger,
  };

  // Platform-specific tokens
  if (messenger.includes("discord")) {
    console.log(chalk.yellow("\nDiscord Bot Token required."));
    console.log("1. Go to https://discord.com/developers/applications");
    console.log("2. New Application → Bot → Reset Token\n");
    const { token } = await inquirer.prompt([
      { name: "token", message: "Discord Bot Token:", type: "password" },
    ]);
    envUpdates.DISCORD_TOKEN = token;
  }

  if (messenger.includes("slack")) {
    console.log(chalk.yellow("\nSlack tokens required."));
    console.log("1. https://api.slack.com/apps → Create New App");
    console.log("2. OAuth & Permissions → Bot Token (xoxb-...)");
    console.log("3. Socket Mode → App Token (xapp-...)\n");
    const { botToken, appToken } = await inquirer.prompt([
      { name: "botToken", message: "Slack Bot Token (xoxb-...):", type: "password" },
      { name: "appToken", message: "Slack App Token (xapp-...):", type: "password" },
    ]);
    envUpdates.SLACK_BOT_TOKEN = botToken;
    envUpdates.SLACK_APP_TOKEN = appToken;
  }

  if (messenger.includes("telegram")) {
    console.log(chalk.yellow("\nTelegram Bot Token required."));
    console.log("1. Message @BotFather → /newbot\n");
    const { token } = await inquirer.prompt([
      { name: "token", message: "Telegram Bot Token:", type: "password" },
    ]);
    const { chatId } = await inquirer.prompt([
      { name: "chatId", message: "Telegram Chat ID:", type: "input" },
    ]);
    envUpdates.TELEGRAM_BOT_TOKEN = token;
    envUpdates.TELEGRAM_CHAT_ID = chatId;
  }

  const { reposPath } = await inquirer.prompt([
    {
      name: "reposPath",
      message: "Project storage path:",
      type: "input",
      default: defaultReposPath(),
    },
  ]);
  envUpdates.REPOS_BASE_PATH = reposPath;
  fs.mkdirSync(reposPath, { recursive: true });

  saveEnv(envUpdates);
  console.log(chalk.green("✓ .env saved"));

  // Step 4: Register products
  console.log(chalk.bold("\n-- Step 4: Register Products --"));
  const products: Product[] = [];

  let addMore = true;
  while (addMore) {
    const { name } = await inquirer.prompt([
      { name: "name", message: "Product/Organization name:", type: "input" },
    ]);
    const { org } = await inquirer.prompt([
      { name: "org", message: "GitHub org (Enter to skip):", type: "input", default: "" },
    ]);

    if (!name) {
      if (!products.length) {
        console.log(chalk.yellow("At least 1 product is required."));
        continue;
      }
      break;
    }

    products.push({
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      github_org: org || undefined,
    });
    console.log(chalk.green(`✓ ${name} registered`));

    const { more } = await inquirer.prompt([
      { name: "more", message: "Add more products?", type: "confirm", default: false },
    ]);
    addMore = more;
  }

  saveProducts(products);

  // Create product directories
  for (const product of products) {
    const productDir = path.join(reposPath, product.slug);
    const dirs = ["product", "memory", "memory/routine-logs", "projects"];

    // Add messenger-specific dirs
    for (const m of messenger.split(",")) {
      dirs.push(m.trim());
    }

    for (const dir of dirs) {
      fs.mkdirSync(path.join(productDir, dir), { recursive: true });
    }

    // Create brief.md
    const briefFile = path.join(productDir, "product", "brief.md");
    if (!fs.existsSync(briefFile)) {
      fs.writeFileSync(briefFile, `# ${product.name} -- Product Brief\n\n## One-line Positioning\n(To be written)\n\n## Current Stage\nPMF Discovery\n`);
    }

    // Create memory schema files
    const schemas: Record<string, string> = {
      "hypotheses.jsonl": '{"_schema":"hypothesis","fields":["id","statement","risk","method","status","date"]}\n',
      "experiments.jsonl": '{"_schema":"experiment","fields":["id","hypothesis_id","method","result","signal_strength","date","next_action"]}\n',
      "decisions.jsonl": '{"_schema":"decision","fields":["date","decision","alternatives","reasoning","emotion_weight"]}\n',
      "signals.jsonl": '{"_schema":"signal","fields":["date","source","type","content","relevance","action"]}\n',
    };
    for (const [fname, schema] of Object.entries(schemas)) {
      const f = path.join(productDir, "memory", fname);
      if (!fs.existsSync(f)) fs.writeFileSync(f, schema);
    }

    console.log(chalk.green(`✓ ${product.name} directory created: ${productDir}`));
  }

  // Step 5: Done
  console.log(chalk.bold.green("\n  Setup Complete!\n"));
  console.log(`  ${chalk.cyan("solo-agents bot")}        — Start messenger bot`);
  console.log(`  ${chalk.cyan("solo-agents schedule")}   — Start automated scheduler`);
  console.log(`  ${chalk.cyan("solo-agents status")}     — Show dashboard`);
  console.log(`  ${chalk.cyan("solo-agents update")}     — Check for updates`);
  console.log(`  ${chalk.cyan("solo-agents doctor")}     — Diagnose issues\n`);
}
