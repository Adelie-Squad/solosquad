import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  getAssetsDir,
  getSolosquadConfigDir,
  getWorkspaceRoot,
} from "../util/paths.js";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  normalizeMessenger,
  saveEnv,
  saveWorkspaceYaml,
} from "../util/config.js";
import { commandExists } from "../util/platform.js";
import { scaffoldOrg, scaffoldRepoYaml, slugify } from "../util/scaffold.js";
import { cloneRepo, isGitRepo, looksLikeGitUrl, slugFromUrl } from "../util/git.js";

const SOLOSQUAD_VERSION = "1.3.1";

const TIMEZONE_PRESETS = [
  { name: "Asia/Seoul (UTC+09) — recommended", value: "Asia/Seoul" },
  { name: "America/Los_Angeles (UTC-08/-07)", value: "America/Los_Angeles" },
  { name: "America/New_York (UTC-05/-04)", value: "America/New_York" },
  { name: "Europe/London (UTC+00/+01)", value: "Europe/London" },
  { name: "UTC", value: "UTC" },
  { name: "Other — type IANA string", value: "__other__" },
];

function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function isValidIanaTimezone(tz: string): boolean {
  try {
    // Throws RangeError on invalid IANA name
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ORG_EXAMPLES = `
  Examples (Elon Musk's portfolio, for illustration):
    tesla           — EVs, energy, autopilot (github.com/teslamotors)
    spacex          — rockets, Starlink
    neuralink       — brain-computer interface
    xai             — Grok, LLM research (github.com/xai-org)
    x-platform      — the X social network

  If you already have a GitHub/GitLab organization, reuse that exact
  slug. Otherwise, pick a short name (lowercase, hyphen-separated).
`;

async function registerRepoInline(
  input: string,
  orgDir: string,
  orgSlug: string
): Promise<{ slug: string; role: string } | null> {
  const reposDir = path.join(orgDir, "repositories");
  fs.mkdirSync(reposDir, { recursive: true });

  let repoDir: string;
  try {
    if (looksLikeGitUrl(input)) {
      const slug = slugFromUrl(input);
      repoDir = path.join(reposDir, slug);
      if (fs.existsSync(repoDir)) {
        console.log(chalk.yellow(`  ! ${slug} already exists — skipping clone.`));
      } else {
        console.log(chalk.dim(`  Cloning ${input} → ${path.relative(process.cwd(), repoDir)}...`));
        cloneRepo(input, repoDir);
      }
    } else {
      const src = path.resolve(input);
      if (!fs.existsSync(src)) {
        console.log(chalk.red(`  ✗ Path does not exist: ${src}`));
        return null;
      }
      const slug = path.basename(src);
      repoDir = path.join(reposDir, slug);
      if (path.resolve(repoDir) === path.resolve(src)) {
        // In-place register
      } else if (fs.existsSync(repoDir)) {
        console.log(chalk.yellow(`  ! ${slug} already exists at destination — skipping move.`));
      } else {
        const { confirm } = await inquirer.prompt([
          {
            name: "confirm",
            type: "confirm",
            message: `Move ${src} → ${repoDir} ?`,
            default: true,
          },
        ]);
        if (!confirm) return null;
        fs.renameSync(src, repoDir);
      }
    }
  } catch (err) {
    console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    return null;
  }

  const { role } = await inquirer.prompt([
    {
      name: "role",
      type: "list",
      message: "Role:",
      choices: ["main", "frontend", "backend", "data", "infra", "docs", "unknown"],
      default: isGitRepo(repoDir) ? "main" : "unknown",
    },
  ]);

  const doc = scaffoldRepoYaml({
    orgDir,
    orgSlug,
    repoDir,
    role,
  });
  return { slug: doc.slug, role: doc.role };
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function initCommand(): Promise<void> {
  console.log(
    chalk.cyan.bold("\n  SoloSquad") +
      " Setup Wizard  " +
      chalk.dim(`(v${SOLOSQUAD_VERSION})\n`) +
      chalk.dim("  Build a 24/7 AI assistant system tailored to your products.\n")
  );

  // Step 1: Environment
  console.log(chalk.bold("-- Step 1: Environment Check --"));
  const checks = {
    Docker: commandExists("docker"),
    "Node.js 18+": parseInt(process.versions.node) >= 18,
    git: commandExists("git"),
    claude: commandExists("claude"),
  };
  for (const [name, ok] of Object.entries(checks)) {
    console.log(` ${ok ? chalk.green("✓") : chalk.red("✗")} ${name}`);
  }
  if (!checks.Docker) {
    console.log(chalk.yellow("\n  Docker not found (optional). See docs/setup-guide.md Option A-2."));
  }

  // Step 2: Workspace layout
  console.log(chalk.bold("\n-- Step 2: Initialize Workspace --"));
  const workspace = getWorkspaceRoot();
  const solosquadDir = getSolosquadConfigDir(workspace);

  if (fs.existsSync(solosquadDir)) {
    console.log(chalk.yellow(`  .solosquad/ already exists at ${workspace}.`));
    console.log(chalk.dim("  Skipping config copy; only add-organization flow will run."));
  }

  // Copy system config into .solosquad/
  const assetsDir = getAssetsDir();
  const assetDirs = ["agents", "routines", "core", "templates", "orchestrator"];
  fs.mkdirSync(solosquadDir, { recursive: true });
  for (const dir of assetDirs) {
    const src = path.join(assetsDir, dir);
    if (fs.existsSync(src)) {
      copyDirSync(src, path.join(solosquadDir, dir));
      console.log(` ${chalk.green("✓")} .solosquad/${dir}/`);
    }
  }

  // .env.example → .solosquad/.env (if missing)
  const envExampleSrc = path.join(assetsDir, ".env.example");
  const envDest = path.join(solosquadDir, ".env");
  if (fs.existsSync(envExampleSrc) && !fs.existsSync(envDest)) {
    fs.copyFileSync(envExampleSrc, envDest);
    console.log(` ${chalk.green("✓")} .solosquad/.env`);
  }

  // docker-compose.yml and Dockerfile at workspace root
  for (const f of ["docker-compose.yml", "Dockerfile"]) {
    const src = path.join(assetsDir, f);
    const dst = path.join(workspace, f);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.log(` ${chalk.green("✓")} ${f}`);
    }
  }

  // Step 3: Configuration
  console.log(chalk.bold("\n-- Step 3: Configuration --"));
  const { workspaceName, ownerName, ownerRole } = await inquirer.prompt([
    {
      name: "workspaceName",
      message: "Workspace display name (blank = folder name):",
      type: "input",
      default: path.basename(workspace) || "solosquad",
    },
    { name: "ownerName", message: "Your name:", type: "input" },
    {
      name: "ownerRole",
      message: "Your role (e.g. developer, designer, founder):",
      type: "input",
    },
  ]);

  const { messenger } = await inquirer.prompt([
    {
      name: "messenger",
      message: "Messenger platform (one per workspace):",
      type: "list",
      choices: [
        { name: "Discord — Best for team channels", value: "discord" },
        { name: "Slack   — Great for workspace integration", value: "slack" },
      ],
    },
  ]);

  const envUpdates: Record<string, string> = {
    OWNER_NAME: ownerName,
    OWNER_ROLE: ownerRole,
    MESSENGER: normalizeMessenger(messenger),
  };

  // Platform-specific tokens
  if (messenger === "discord") {
    console.log(chalk.yellow("\nDiscord Bot Token required."));
    console.log("  https://discord.com/developers/applications → Bot → Reset Token");
    console.log("  Also enable: Bot → Privileged Gateway Intents → MESSAGE CONTENT");
    console.log("  Bot permissions: View Channels, Send Messages, Read Message History, Create Public Threads\n");
    const { token } = await inquirer.prompt([
      { name: "token", message: "Discord Bot Token:", type: "password" },
    ]);
    envUpdates.DISCORD_TOKEN = token;
  }
  if (messenger === "slack") {
    console.log(chalk.yellow("\nSlack tokens required."));
    console.log("  1. https://api.slack.com/apps → Create New App");
    console.log("  2. OAuth & Permissions → Bot Token (xoxb-...)");
    console.log("  3. Socket Mode → Enable → App-Level Token (xapp-...)");
    console.log("  4. Bot Token scopes: channels:read, channels:manage, chat:write, app_mentions:read, channels:history");
    console.log("  5. Event Subscriptions → subscribe to message.channels\n");
    const { botToken, appToken } = await inquirer.prompt([
      { name: "botToken", message: "Slack Bot Token (xoxb-...):", type: "password" },
      { name: "appToken", message: "Slack App Token (xapp-...):", type: "password" },
    ]);
    envUpdates.SLACK_BOT_TOKEN = botToken;
    envUpdates.SLACK_APP_TOKEN = appToken;
  }

  saveEnv(envUpdates, workspace);
  console.log(chalk.green("✓ .solosquad/.env saved"));

  // Step 3.5: Timezone and brief schedule (v1.2.4+)
  console.log(chalk.bold("\n-- Step 3.5: Timezone & Daily Briefs --"));
  console.log(
    chalk.dim(
      "  SoloSquad posts two daily briefs (morning/evening) in the #workflow channel.\n" +
        "  All routine schedules use this timezone."
    )
  );

  let { timezone } = await inquirer.prompt([
    {
      name: "timezone",
      message: "Timezone:",
      type: "list",
      choices: TIMEZONE_PRESETS,
      default: DEFAULT_WORKSPACE_SETTINGS.timezone,
    },
  ]);
  if (timezone === "__other__") {
    const { customTz } = await inquirer.prompt([
      {
        name: "customTz",
        message: "IANA timezone string (e.g. Asia/Tokyo):",
        type: "input",
        validate: (v: string) =>
          isValidIanaTimezone(v) || "Invalid IANA timezone name",
      },
    ]);
    timezone = customTz;
  }

  const { morningTime, eveningTime } = await inquirer.prompt([
    {
      name: "morningTime",
      message: "Morning brief time (HH:MM):",
      type: "input",
      default: DEFAULT_WORKSPACE_SETTINGS.briefings.morning.time,
      validate: (v: string) => isValidHHMM(v) || "HH:MM (00:00–23:59)",
    },
    {
      name: "eveningTime",
      message: "Evening brief time (HH:MM):",
      type: "input",
      default: DEFAULT_WORKSPACE_SETTINGS.briefings.evening.time,
      validate: (v: string) => isValidHHMM(v) || "HH:MM (00:00–23:59)",
    },
  ]);
  console.log(
    chalk.dim(
      `  Background routines (signal-scan ${DEFAULT_WORKSPACE_SETTINGS.background_routines.signal_scan.time}, ` +
        `experiment-check ${DEFAULT_WORKSPACE_SETTINGS.background_routines.experiment_check.time}, ` +
        `weekly-review ${DEFAULT_WORKSPACE_SETTINGS.background_routines.weekly_review.day} ${DEFAULT_WORKSPACE_SETTINGS.background_routines.weekly_review.time}) ` +
        `feed into the briefs. Edit workspace.yaml later to change.`
    )
  );

  // Step 4: workspace.yaml
  saveWorkspaceYaml(
    {
      version: SOLOSQUAD_VERSION,
      display_name: workspaceName || path.basename(workspace),
      persona: "personal",
      timezone,
      briefings: {
        morning: { time: morningTime, enabled: true },
        evening: { time: eveningTime, enabled: true },
      },
      background_routines: {
        signal_scan: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.signal_scan },
        experiment_check: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.experiment_check },
        weekly_review: { ...DEFAULT_WORKSPACE_SETTINGS.background_routines.weekly_review },
      },
      created_at: new Date().toISOString(),
      last_migrated_to: SOLOSQUAD_VERSION,
    },
    workspace
  );
  console.log(chalk.green("✓ .solosquad/workspace.yaml"));

  // Step 5: First organization
  console.log(chalk.bold("\n-- Step 5: First Organization --"));
  console.log(chalk.dim(ORG_EXAMPLES));

  const { orgName } = await inquirer.prompt([
    { name: "orgName", message: "Organization name:", type: "input" },
  ]);
  let orgSlug: string | null = null;
  if (!orgName) {
    console.log(chalk.yellow("  No organization provided — skipping. Run `solosquad add org <name>` later."));
  } else {
    const { provider, remoteUrl } = await inquirer.prompt([
      {
        name: "provider",
        message: "Provider:",
        type: "list",
        choices: ["local", "github", "gitlab", "gitea"],
        default: "github",
      },
      {
        name: "remoteUrl",
        message: "Remote URL (Enter to skip):",
        type: "input",
        default: "",
      },
    ]);

    const { orgDir } = scaffoldOrg({
      workspace,
      name: orgName,
      provider,
      remoteUrl: remoteUrl || null,
      messenger,
    });
    orgSlug = path.basename(orgDir);
    console.log(chalk.green(`✓ ${orgSlug}/ organization created`));

    // Step 5.1: Register repositories (loop)
    console.log(chalk.bold("\n-- Step 5.1: Register Repositories (optional) --"));
    console.log(chalk.dim(
      "  You can paste a git URL to clone, or a local path to register.\n" +
      "  Leave empty to skip. Repeat to add more."
    ));

    while (true) {
      const { repoInput } = await inquirer.prompt([
        {
          name: "repoInput",
          message: `Add repo to ${orgSlug} (git URL or local path, blank to finish):`,
          type: "input",
        },
      ]);
      if (!repoInput) break;

      const registered = await registerRepoInline(repoInput, orgDir, orgSlug);
      if (registered) {
        console.log(chalk.green(`✓ ${registered.slug} (${registered.role}) registered`));
      }
    }
  }

  // Step 6: Security checklist
  console.log(chalk.bold("\n-- Step 6: Safety & Security --"));
  const gitignore = path.join(workspace, ".gitignore");
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, "utf-8");
    const hasEnv = content.includes(".env") || content.includes(".solosquad/");
    if (hasEnv) {
      console.log(` ${chalk.green("✓")} .gitignore excludes .env or .solosquad/`);
    } else {
      console.log(` ${chalk.red("✗")} Add ".solosquad/.env" (or .env) to .gitignore`);
    }
  } else {
    console.log(chalk.yellow(" △ No .gitignore — creating one with .solosquad/.env excluded"));
    fs.writeFileSync(gitignore, ".solosquad/.env\nnode_modules/\n*.log\n");
  }
  console.log("\n  Security checklist:");
  console.log("  1. Never commit .solosquad/.env or credential files");
  console.log("  2. Rotate bot tokens periodically (90 days recommended)");
  console.log("  3. Review AI outputs before deploying to production");
  console.log("  4. Keep bot scopes minimal");
  console.log("  5. Run `solosquad doctor` regularly");

  // Step 7: Layout preview
  console.log(chalk.bold("\n-- Step 7: Layout --"));
  console.log(chalk.dim(`  ${workspace}/`));
  console.log(chalk.dim("    .solosquad/"));
  console.log(chalk.dim("      workspace.yaml"));
  console.log(chalk.dim("      .env"));
  console.log(chalk.dim("      agents/ routines/ core/ templates/ orchestrator/"));
  if (orgSlug) {
    console.log(chalk.dim(`    ${orgSlug}/              (org)`));
    console.log(chalk.dim("      .org.yaml"));
    console.log(chalk.dim("      memory/ workflows/"));
    console.log(chalk.dim(`      ${messenger}/`));
    console.log(chalk.dim("      repositories/        (repos live here)"));
  }
  console.log(chalk.dim("    docker-compose.yml  Dockerfile"));

  console.log(chalk.bold.green("\n  Setup Complete!\n"));
  console.log(`  ${chalk.cyan("solosquad bot")}        — Start messenger bot`);
  console.log(`  ${chalk.cyan("solosquad schedule")}   — Start automated scheduler`);
  console.log(`  ${chalk.cyan("solosquad status")}     — Show dashboard`);
  console.log(`  ${chalk.cyan("solosquad update")}     — Check for updates`);
  console.log(`  ${chalk.cyan("solosquad doctor")}     — Diagnose issues`);
  console.log(`  ${chalk.cyan("solosquad migrate")}    — Upgrade workspace layout`);
  console.log(`  ${chalk.cyan("solosquad add org")}    — Add another organization`);
  console.log(`  ${chalk.cyan("solosquad add repo")}   — Add a repository`);
  console.log(`  ${chalk.cyan("solosquad sync")}       — Sync repositories/ with .org.yaml\n`);
}
