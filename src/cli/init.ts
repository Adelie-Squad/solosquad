import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { execFile, spawn } from "child_process";
import {
  getAssetsDir,
  getSolosquadConfigDir,
} from "../util/paths.js";
import { findWorkspaceRoot } from "../migrations/detect.js";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  normalizeMessenger,
  saveEnv,
  saveWorkspaceYaml,
} from "../util/config.js";
import { commandExists, IS_WINDOWS } from "../util/platform.js";
import { scaffoldOrg, slugify } from "../util/scaffold.js";
import { isGitRepo, looksLikeGitUrl, slugFromUrl } from "../util/git.js";
import { detectV05Usage } from "./detect-v05-usage.js";
import {
  deriveChannelNames,
  isValidHandle,
  normalizeHandle,
  saveUserYaml,
  userYamlExists,
  type UserYaml,
} from "../bot/user-registry.js";
import { SOLOSQUAD_VERSION } from "../util/version.js";

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

interface ClaudeAuthStatus {
  loggedIn: boolean;
  subscriptionType?: string;
}

/**
 * v1.0 — query `claude auth status --json`. Returns `{ loggedIn: false }` if
 * the binary is missing or stdout cannot be parsed.
 */
function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  return new Promise((resolve) => {
    const useShell = IS_WINDOWS;
    const cmd = useShell ? "claude auth status --json" : "claude";
    const args = useShell ? [] : ["auth", "status", "--json"];
    execFile(
      cmd,
      args,
      { shell: useShell, maxBuffer: 1024 * 1024 },
      (_err, stdout) => {
        try {
          const parsed = JSON.parse(stdout) as ClaudeAuthStatus;
          resolve(parsed);
        } catch {
          resolve({ loggedIn: false });
        }
      },
    );
  });
}

/**
 * v1.0 — spawn `claude login` with inherited stdio so the user sees the
 * OAuth flow (browser opens, user pastes the redirect code if applicable).
 * Resolves when the child exits with code 0; rejects otherwise.
 */
function runClaudeLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const useShell = IS_WINDOWS;
    const child = useShell
      ? spawn("claude login", [], { shell: true, stdio: "inherit" })
      : spawn("claude", ["login"], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`claude login exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * v1.0 — Step 1.5 Claude Code Authentication. Detects current auth state and
 * runs `claude login` if needed. Aborts init when auth cannot be established —
 * downstream wizard steps assume a working Claude backend.
 */
async function ensureClaudeAuth(): Promise<void> {
  console.log(chalk.bold("\n-- Step 1.5: Claude Code Authentication --"));
  console.log(
    chalk.dim(
      "  SoloSquad invokes Claude Code via OAuth. v1.0 supports Claude Code as the single backend.",
    ),
  );

  if (!commandExists("claude")) {
    console.log(chalk.red("  ✗ `claude` CLI not found in PATH."));
    console.log(chalk.dim("    Install: npm install -g @anthropic-ai/claude-code"));
    console.log(chalk.dim("    Then re-run `solosquad init`."));
    process.exit(1);
  }

  const status = await getClaudeAuthStatus();
  if (status.loggedIn) {
    const subtype = status.subscriptionType ?? "active";
    console.log(chalk.green(`  ✓ Claude Code already authenticated (subscription: ${subtype})`));
    return;
  }

  console.log(chalk.yellow("  Not logged in. Launching `claude login` to open your browser."));
  console.log(chalk.dim("  Complete the OAuth flow, then return here."));
  const { proceed } = await inquirer.prompt([
    {
      name: "proceed",
      type: "confirm",
      message: "Open `claude login` now?",
      default: true,
    },
  ]);
  if (!proceed) {
    console.log(
      chalk.red(
        "  ✗ Claude Code authentication is required for SoloSquad bot/scheduler to work. Aborting init.",
      ),
    );
    process.exit(1);
  }

  try {
    await runClaudeLogin();
  } catch (err) {
    console.log(chalk.red(`  ✗ \`claude login\` failed: ${(err as Error).message}`));
    process.exit(1);
  }

  const after = await getClaudeAuthStatus();
  if (!after.loggedIn) {
    console.log(
      chalk.red(
        "  ✗ Authentication did not complete. Re-run `solosquad init` after `claude login` succeeds.",
      ),
    );
    process.exit(1);
  }
  const subtype = after.subscriptionType ?? "active";
  console.log(chalk.green(`  ✓ Claude Code authenticated (subscription: ${subtype})`));
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

/**
 * v1.0 — path-reference only. URL clone + Move-into-workspace removed.
 *
 * The wizard accepts a local path that is *already* a git repo and registers
 * it as a path-reference (no move, no copy). SoloSquad does not own git
 * clone semantics (auth / branch / depth / submodules / LFS); use your own
 * git toolchain to clone first, then re-add the local path.
 *
 * Legacy v0.9.x workspaces with repos already inside the workspace tree keep
 * working via `resolveRepoCwd` (`src/util/paths.ts`).
 */
async function registerRepoInline(
  input: string,
  orgDir: string,
  orgSlug: string
): Promise<{ slug: string; role: string } | null> {
  if (looksLikeGitUrl(input)) {
    const suggestedSlug = slugFromUrl(input);
    console.log(chalk.red(`  ✗ Git URL is not accepted in v1.0 path-reference mode.`));
    console.log(
      chalk.dim(
        `    Clone the repo locally first with your own git toolchain, then re-add the path.\n` +
          `    Example:  git clone ${input} ~/code/${suggestedSlug}\n` +
          `    Then re-run this prompt with the local path.`,
      ),
    );
    return null;
  }

  const src = path.resolve(input);
  if (!fs.existsSync(src)) {
    console.log(chalk.red(`  ✗ Path does not exist: ${src}`));
    return null;
  }
  if (!isGitRepo(src)) {
    console.log(chalk.red(`  ✗ Not a git repo (no .git/): ${src}`));
    console.log(
      chalk.dim(
        `    v1.0 registers repos by path-reference and requires a git repo at the path.\n` +
          `    Run \`git init\` (or \`git clone <url> ${src}\`) first, then re-add.`,
      ),
    );
    return null;
  }

  const reposDir = path.join(orgDir, "repositories");
  fs.mkdirSync(reposDir, { recursive: true });
  const slug = path.basename(src);
  const yamlPath = path.join(reposDir, `${slug}.yaml`);
  if (fs.existsSync(yamlPath)) {
    console.log(chalk.yellow(`  ! ${slug} already registered. Skipping.`));
    return null;
  }
  const legacyDir = path.join(reposDir, slug);
  if (fs.existsSync(legacyDir)) {
    console.log(
      chalk.yellow(
        `  ! A legacy repositories/${slug}/ directory already exists in the workspace.\n` +
          `    Pick a different folder name or move the legacy tree before re-adding.`,
      ),
    );
    return null;
  }

  // v1.0.1 — repo role is deprecated and no longer prompted. New
  // registrations default to "main" silently. Multi-repo intent is
  // resolved at message time via @<slug> mention parser + PM clarifying
  // question. See RepoYaml.role JSDoc in src/util/config.ts.
  const role = "main";

  const yaml = await import("js-yaml");
  const { detectLanguage, getRemoteUrl } = await import("../util/git.js");
  const doc = {
    slug,
    name: slug,
    role,
    language: detectLanguage(src) ?? undefined,
    linked_org: orgSlug,
    remote_url: getRemoteUrl(src),
    products: [],
    registered_at: new Date().toISOString(),
    path: src,
  };
  fs.writeFileSync(yamlPath, yaml.dump(doc, { lineWidth: 100 }), "utf-8");

  // Mirror inside external repo (class A* — single file)
  const externalDotDir = path.join(src, ".solosquad");
  fs.mkdirSync(externalDotDir, { recursive: true });
  const externalYaml = path.join(externalDotDir, "repo.yaml");
  if (!fs.existsSync(externalYaml)) {
    fs.writeFileSync(externalYaml, yaml.dump(doc, { lineWidth: 100 }), "utf-8");
  }
  console.log(chalk.green(`  ✓ ${slug} registered as path-reference → ${src}`));
  return { slug, role };
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

/**
 * v0.6 §2.2 — Organization Layer Specialization stubs.
 *
 * Writes empty placeholders for `<org>/core/{PRINCIPLES.md, VOICE.md}`,
 * `<org>/agent-profile.yaml`, and `<org>/domain/README.md`. Each file is
 * only created when missing, so re-running `init` on an existing org is
 * idempotent and never clobbers user edits.
 */
function scaffoldV06OrgLayer(orgDir: string, orgSlug: string): void {
  const coreDir = path.join(orgDir, "core");
  fs.mkdirSync(coreDir, { recursive: true });
  const principles = path.join(coreDir, "PRINCIPLES.md");
  if (!fs.existsSync(principles)) {
    fs.writeFileSync(
      principles,
      `# ${orgSlug} — Principles\n\n<!-- v0.6 §2.2 — Document the principles every agent in this org follows. -->\n`,
    );
  }
  const voice = path.join(coreDir, "VOICE.md");
  if (!fs.existsSync(voice)) {
    fs.writeFileSync(
      voice,
      `# ${orgSlug} — Voice & Tone\n\n<!-- v0.6 §2.2 — How this org speaks (formal, concise, conservative). -->\n`,
    );
  }

  const profile = path.join(orgDir, "agent-profile.yaml");
  if (!fs.existsSync(profile)) {
    const minimal =
      `# v0.6 §2.2 — Organization Layer Specialization.\n` +
      `# Per-agent modifier (defaults + optional per-agent overrides).\n` +
      `# See docs/plan/v0.6-default-workflow-tuning.md §2.2 for the schema.\n` +
      `schema_version: 1\n` +
      `defaults:\n` +
      `  # tone: conservative\n` +
      `  # priorities: []\n` +
      `  # budget:\n` +
      `  #   daily_usd: 5\n` +
      `  #   weekly_usd: 25\n` +
      `  #   on_cap_action: pause\n`;
    fs.writeFileSync(profile, minimal);
  }

  const domainDir = path.join(orgDir, "domain");
  fs.mkdirSync(domainDir, { recursive: true });
  const domainReadme = path.join(domainDir, "README.md");
  if (!fs.existsSync(domainReadme)) {
    fs.writeFileSync(
      domainReadme,
      `# ${orgSlug} — Domain knowledge\n\n<!-- v0.6 §2.2 — Drop org-specific market/customer/product notes here. -->\n`,
    );
  }
}

/**
 * v0.6 §2.3 — Workspace Knowledge Layer stub.
 *
 * Creates `<workspace>/.solosquad/knowledge/README.md` pointing at the
 * bundled starter guide. Idempotent.
 */
function scaffoldV06WorkspaceKnowledge(workspace: string): void {
  const dir = path.join(workspace, ".solosquad", "knowledge");
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# Workspace knowledge\n\n` +
        `<!-- v0.6 §2.3 — User-accumulated craft, decision frameworks, glossary. -->\n` +
        `<!-- Files here are keyword-selected at spawn time (8-layer JIT [1]). -->\n` +
        `<!-- See assets/knowledge/README.md for the authoring guide. -->\n`,
    );
  }
}

/**
 * v1.0.2 — user identity selection, split into 3 phases so the wizard can
 * prompt for handle *right after token entry* (Step 3.5, "narrative
 * connectivity"), defer yaml write until the org is scaffolded (Step 6).
 *
 * Pre-v1.0.2 had a monolithic `registerUserIdentity` that fired at Step 5.2
 * — after timezone + workspace.yaml + org + repos were all done — leaving 4
 * unrelated prompts between token entry and the handle confirmation.
 *
 * Phases:
 *   1. `fetchBotIdentity(messenger, token)` — call API, no UI
 *   2. `promptHandleSelection(...)` — show guidance + handle prompt
 *   3. `saveUserYamlForChoice(...)` — write yaml once org exists
 */

interface BotIdentity {
  handle: string;       // bot's username, normalized to handle charset
  botUserId: string;
  appId?: string;
}

interface IdentityChoice {
  handle: string;       // the handle the user actually wants
  bot: BotIdentity;     // the bot's own identity (for bot_user_id field)
}

async function fetchBotIdentity(
  messenger: "discord" | "slack",
  token: string,
): Promise<BotIdentity | null> {
  try {
    if (messenger === "discord") {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        id?: string;
        username?: string;
        application_id?: string;
      };
      if (!body.id || !body.username) return null;
      return {
        handle: normalizeHandle(body.username),
        botUserId: body.id,
        appId: body.application_id,
      };
    }
    // slack
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      ok?: boolean;
      user?: string;
      user_id?: string;
      bot_id?: string;
    };
    if (!body.ok || !body.user_id || !body.user) return null;
    return {
      handle: normalizeHandle(body.user),
      botUserId: body.user_id,
      appId: body.bot_id,
    };
  } catch {
    return null;
  }
}

async function promptHandleSelection(args: {
  messenger: "discord" | "slack";
  envUpdates: Record<string, string>;
}): Promise<IdentityChoice | null> {
  const token =
    args.messenger === "discord"
      ? args.envUpdates.DISCORD_TOKEN || process.env.DISCORD_TOKEN
      : args.envUpdates.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  const extracted = await fetchBotIdentity(args.messenger, token);
  if (!extracted) {
    console.log(
      chalk.yellow(
        "  △ Could not reach messenger API to extract bot handle. Skipping per-user yaml.",
      ),
    );
    console.log(
      chalk.dim(
        "    Re-run init after the token is valid, or run `solosquad migrate --apply` later.",
      ),
    );
    return null;
  }

  // v1.0.2 — guidance text. Handle is the SoloSquad canonical user
  // identifier (since author-guard no longer compares it against Discord
  // username). Channel name + workflow routing both derive from this.
  console.log(
    chalk.dim(
      `  Bot account on ${args.messenger}: ${chalk.cyan(extracted.handle)} (auto-detected).`,
    ),
  );
  console.log(
    chalk.dim(
      `  Channels will be created as: command-<your-handle> / works-<your-handle>`,
    ),
  );
  console.log(
    chalk.bold("\n  💡 Pick a handle that is unique in your messenger server"),
  );
  console.log(
    chalk.dim(
      `  - Different from other ${args.messenger} members' usernames or display names\n` +
        `    → avoids \"who said this\" confusion in shared channels\n` +
        `  - Charset: only [a-z 0-9 _]; other chars become _ automatically\n` +
        `  - This handle = your SoloSquad identity (workflow routing, memory partition)`,
    ),
  );

  const { confirmHandle } = await inquirer.prompt([
    {
      name: "confirmHandle",
      message: `Your handle (Enter = use \"${extracted.handle}\", or type a different one):`,
      type: "input",
      default: extracted.handle,
      validate: (v: string) => {
        const normalized = normalizeHandle(v);
        if (!isValidHandle(normalized)) {
          return "Only lowercase a-z, 0-9, underscore allowed";
        }
        return true;
      },
    },
  ]);
  return {
    handle: normalizeHandle(confirmHandle),
    bot: extracted,
  };
}

function saveUserYamlForChoice(args: {
  workspace: string;
  orgSlug: string;
  messenger: "discord" | "slack";
  choice: IdentityChoice;
  ownerName: string;
}): boolean {
  const { handle } = args.choice;
  if (userYamlExists(args.orgSlug, handle, args.workspace)) {
    console.log(
      chalk.red(
        `  ✗ ${handle}은 이미 ${args.orgSlug}에 등록되어 있습니다.`,
      ),
    );
    console.log(
      chalk.dim(
        "    다른 messenger handle 또는 별도 워크스페이스를 사용하세요.",
      ),
    );
    return false;
  }
  const doc: UserYaml = {
    schema_version: 1,
    handle,
    display_name: args.ownerName || undefined,
    messenger: args.messenger,
    bot_application_id: args.choice.bot.appId,
    bot_user_id: args.choice.bot.botUserId,
    joined_at: new Date().toISOString(),
    workspace_path: args.workspace,
    channels: deriveChannelNames(handle),
  };
  try {
    saveUserYaml(args.orgSlug, doc, args.workspace, false);
    console.log(
      chalk.green(
        `  ✓ user yaml saved: ${args.orgSlug}/.solosquad/users/${handle}.yaml`,
      ),
    );
    return true;
  } catch (err) {
    console.log(
      chalk.red(`  ✗ Failed to save user yaml: ${(err as Error).message}`),
    );
    return false;
  }
}

/**
 * v0.8.5 §4.1 — Workspace path resolution for `init`.
 *
 * Other commands rely on `getWorkspaceRoot()` which walks up from CWD to find
 * an existing `.solosquad/`. That's the right call for `bot`, `status`, etc.
 * — but for `init`, walk-up can quietly redirect a fresh init to a parent's
 * workspace, contradicting user intent. Here we:
 *   1. If CWD already has `.solosquad/` → reuse it (idempotent re-init).
 *   2. If a parent has `.solosquad/` → prompt user: existing / cwd / custom.
 *   3. Else → use CWD silently (the user has already chosen the directory
 *      via `mkdir <name> && cd <name>`; re-asking is redundant friction).
 *
 * Returns the absolute workspace path the rest of the wizard will use.
 */
async function resolveInitWorkspace(): Promise<string> {
  const cwd = process.cwd();
  const cwdHasWorkspace = fs.existsSync(path.join(cwd, ".solosquad"));
  if (cwdHasWorkspace) return cwd;

  const upstream = findWorkspaceRoot(cwd);

  if (upstream && upstream !== cwd) {
    console.log(
      chalk.yellow(
        `  ⚠ Existing SoloSquad workspace detected at a parent directory: ${upstream}`,
      ),
    );
    const { choice } = await inquirer.prompt([
      {
        name: "choice",
        type: "list",
        message: "Where should the workspace be created?",
        choices: [
          {
            name: `Create new workspace at current path: ${cwd}  (recommended)`,
            value: "cwd",
          },
          { name: `Use existing workspace at: ${upstream}`, value: "existing" },
          { name: "Specify a different path", value: "custom" },
        ],
        default: "cwd",
      },
    ]);
    if (choice === "existing") return upstream;
    if (choice === "cwd") return cwd;
    const { customPath } = await inquirer.prompt([
      {
        name: "customPath",
        type: "input",
        message: "Workspace path:",
        default: cwd,
        validate: (v: string) => v.trim().length > 0 || "Path required",
      },
    ]);
    return path.resolve(customPath);
  }

  console.log(chalk.dim(`  Workspace will be created at: ${cwd}`));
  console.log(
    chalk.dim(
      "  (To use a different path, exit with Ctrl-C and re-run from there.)",
    ),
  );
  return cwd;
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

  // Step 1.5: Claude Code authentication (v1.0 — wizard handles the OAuth flow)
  await ensureClaudeAuth();

  // Step 2: Workspace layout
  console.log(chalk.bold("\n-- Step 2: Create Workspace --"));
  console.log(
    chalk.dim(
      "  The workspace is the directory holding all SoloSquad data\n" +
        "  (.env, memory, workflows, org metadata). The directory you ran\n" +
        "  `solosquad init` from will become the workspace.",
    ),
  );
  const workspace = await resolveInitWorkspace();
  fs.mkdirSync(workspace, { recursive: true });
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
  console.log(
    chalk.dim(
      "  Your name + role are used by the PM and specialist agents to address\n" +
        "  you and tune the depth/tone of their replies (saved to .solosquad/.env).",
    ),
  );
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
      default: "founder",
    },
  ]);

  console.log(
    chalk.dim(
      "\n  One workspace = one messenger. For multi-workspace (n-job) setups,\n" +
        "  create a separate workspace directory per messenger.",
    ),
  );
  const { messenger } = await inquirer.prompt([
    {
      name: "messenger",
      message: "Messenger platform:",
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
    console.log("  4. Bot Token scopes (ALL FIVE required):");
    console.log("       channels:read       — list channels");
    console.log(chalk.bold("       channels:manage     — auto-create command-<handle>/works-<handle>"));
    console.log("       chat:write          — send messages");
    console.log("       app_mentions:read   — receive @mentions");
    console.log("       channels:history    — read thread context");
    console.log(chalk.yellow("     ⚠ After adding scopes, click 'Reinstall to Workspace' or"));
    console.log(chalk.yellow("       new tokens won't include the added scopes (missing_scope error)."));
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

  // Step 3.5: User Identity on the messenger (v1.0.2 — moved up from old
  // Step 5.2 so the handle prompt directly follows the token entry. The
  // chosen handle is deferred to Step 6 yaml write; here we only ask).
  const messengerPlatform = (messenger === "slack" ? "slack" : "discord") as
    | "discord"
    | "slack";
  console.log(
    chalk.bold(`\n-- Step 3.5: Your Handle on ${messengerPlatform} --`),
  );
  const identityChoice = await promptHandleSelection({
    messenger: messengerPlatform,
    envUpdates,
  });

  // Step 4: Timezone and brief schedule (v0.2.4+; renumbered from 3.5 in v1.0.2)
  console.log(chalk.bold("\n-- Step 4: Timezone & Daily Briefs --"));
  console.log(
    chalk.dim(
      "  Default routines: Morning Brief (08:00) · Evening Brief (18:00) ·\n" +
        "  PM Compaction (23:00). The timezone applies to all routine schedules.",
    ),
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
  // Step 5: workspace.yaml (renumbered from 4 in v1.0.2)
  // v0.8.5 — `background_routines` block intentionally omitted. The 4 analysis
  // routines (signal-scan / experiment-check / weekly-review / v06-retrospective-stats)
  // were removed; the live scheduler now ships only morning/evening brief +
  // PM compaction + infrastructure (archive-rotate / log-rotate).
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
      created_at: new Date().toISOString(),
      last_migrated_to: SOLOSQUAD_VERSION,
    },
    workspace
  );
  console.log(chalk.green("✓ .solosquad/workspace.yaml"));

  // Step 6: First organization (renumbered from 5 in v1.0.2)
  console.log(chalk.bold("\n-- Step 6: First Organization --"));
  console.log(
    chalk.dim(
      "  An organization (org) = a business/product unit. One workspace can hold\n" +
        "  multiple orgs (e.g. `tesla` + `spacex`); each isolates memory, workflows,\n" +
        "  and repositories.",
    ),
  );
  console.log(chalk.dim(ORG_EXAMPLES));

  const { orgName } = await inquirer.prompt([
    { name: "orgName", message: "Organization name:", type: "input" },
  ]);
  let orgSlug: string | null = null;
  if (!orgName) {
    console.log(chalk.yellow("  No organization provided — skipping. Run `solosquad add org <name>` later."));
  } else {
    console.log(
      chalk.dim(
        "  Provider = where this org's code is hosted. `solosquad add repo` uses\n" +
          "  this to infer the host when you paste a git URL later. Pick `local` if\n" +
          "  the org has no remote.",
      ),
    );
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
        message: "Org homepage URL (e.g. https://github.com/tesla — Enter to skip):",
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

    // v0.6 §2.2 — Organization Layer Specialization stubs.
    scaffoldV06OrgLayer(orgDir, orgSlug);
    console.log(chalk.green(`✓ ${orgSlug}/core, agent-profile.yaml, domain/ scaffolded`));

    // Sync bundled agent roster into <org>/.claude/agents/ so Claude
    // Code's Task tool can find specialists immediately after init.
    // Historically only the v0.2.4→v0.3.0 migration ran this; we
    // restore it on the init path so fresh installs see the full agent
    // list out of the box.
    try {
      const { syncAgentsToOrg } = await import("../bot/agents-builder.js");
      const synced = syncAgentsToOrg(workspace, orgSlug);
      if (synced.length > 0) {
        console.log(
          chalk.green(`✓ ${synced.length} agents synced into .claude/agents/`)
        );
      }
    } catch (err) {
      console.log(
        chalk.yellow(
          `⚠ Agent sync failed: ${(err as Error).message}. Run \`solosquad sync\` to retry.`
        )
      );
    }

    // Step 6.1: Register repositories (loop) — v1.0 path-reference only (renumbered from 5.1 in v1.0.2)
    console.log(chalk.bold("\n-- Step 6.1: Register Repositories (optional) --"));
    console.log(chalk.dim(
      "  Paste a local path that is already a git repo.\n" +
      "  SoloSquad registers the path (no move, no copy) — your existing dev tree stays in place.\n" +
      "  Leave empty to skip. Repeat to add more.\n" +
      "  Need to clone? Run `git clone <url> <path>` first, then re-add the path here."
    ));

    while (true) {
      const { repoInput } = await inquirer.prompt([
        {
          name: "repoInput",
          message: `Add repo to ${orgSlug} (local path to an existing git repo, blank to finish):`,
          type: "input",
        },
      ]);
      if (!repoInput) break;

      const registered = await registerRepoInline(repoInput, orgDir, orgSlug);
      if (registered) {
        console.log(chalk.green(`✓ ${registered.slug} registered`));
      }
    }

    // v1.0.2 — user identity yaml save. The handle was already chosen in
    // Step 3.5 right after token entry; here we only persist it now that
    // the org dir exists.
    if (identityChoice) {
      saveUserYamlForChoice({
        workspace,
        orgSlug,
        messenger: messengerPlatform,
        choice: identityChoice,
        ownerName,
      });
    }
  }

  // v0.6 §2.3 — Workspace Knowledge Layer stub (org-independent).
  scaffoldV06WorkspaceKnowledge(workspace);
  console.log(chalk.green("✓ .solosquad/knowledge/ scaffolded"));

  // Step 7: Security checklist (renumbered from 6 in v1.0.2)
  console.log(chalk.bold("\n-- Step 7: Safety & Security --"));
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

  // Step 7.5: Onboarding track (v0.6 §2.6; renumbered from 6.5 in v1.0.2)
  //
  // v0.6 §2.6 — 두 트랙 분기:
  //   - 기존 v0.5 사용자 (analysis-ledger.yaml 존재) → templates/{workflow}/SKILL.md
  //     를 *그대로 유지*. 회고 결과는 opt-in (`solosquad migrate --apply`).
  //   - 신규 사용자 (ledger 없음) → templates/를 *회고 결과 버전*으로 init.
  //
  // v0.6 §2.6 — 회고 결과 templates 갱신은 별도 작업. 현재 시점은 *분기점*만
  // 마련하고, 회고 결과가 누적되기 전까지는 양쪽 트랙 모두 v0.5 templates
  // 그대로 사용한다. 사용자에게는 어떤 트랙인지만 알린다.
  console.log(chalk.bold("\n-- Step 7.5: Onboarding Track (v0.6 §2.6) --"));
  const isV05User = detectV05Usage(workspace);
  if (isV05User) {
    console.log(
      ` ${chalk.cyan("•")} 기존 v0.5 사용자 트랙: v0.5 analysis-ledger 감지`
    );
    console.log(
      chalk.dim(
        "   templates/{workflow}/SKILL.md를 그대로 유지합니다. 회고 결과 적용은 " +
          "`solosquad migrate --apply`로 opt-in."
      )
    );
  } else {
    console.log(
      ` ${chalk.cyan("•")} 신규 사용자 트랙: v0.5 ledger 없음`
    );
    console.log(
      chalk.dim(
        "   templates/는 회고 결과 default를 받습니다 (v0.6 §2.6). 현재는 v0.6 " +
          "회고 누적 전이라 v0.5 templates와 동일."
      )
    );
  }

  // Step 8: Layout preview (renumbered from 7 in v1.0.2)
  console.log(chalk.bold("\n-- Step 8: Layout --"));
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
