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
import { commandExists, IS_WINDOWS, normalizeUserPath } from "../util/platform.js";
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
  rawInput: string,
  orgDir: string,
  orgSlug: string
): Promise<{ slug: string; role: string } | null> {
  // v1.2.4 §A.4 — strip surrounding quotes from user-pasted path.
  // PowerShell / Explorer "Copy as path" both wrap paths in `"..."` and
  // the literal quotes leak into `path.resolve`. The normalizer is a
  // pure trim + balanced-quote-strip; cross-platform separators are
  // handled by `path.resolve` itself.
  const input = normalizeUserPath(rawInput);
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

  // v1.2.4 §A.5 — pre-grant Claude Code's directory trust for the
  // registered repo path so the bot's `claude --print` spawn doesn't
  // hit the interactive trust dialog the first time it operates in the
  // repo. Best-effort: skip silently when ~/.claude.json is missing
  // (fresh Claude install), error-tolerant on write failure.
  try {
    const { grantClaudeTrust } = await import("../util/claude-trust.js");
    grantClaudeTrust(src);
  } catch {
    /* trust grant is best-effort */
  }

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
  /** v1.2.9 — Developer Portal app owner's user id (`application.owner.id`).
   *  Used as the *default* for the owner-only gate prompt. Undefined for
   *  team-owned apps (where `owner` is a team, not an individual). */
  ownerUserId?: string;
}

interface IdentityChoice {
  handle: string;       // the handle the user actually wants
  bot: BotIdentity;     // the bot's own identity (for bot_user_id field)
  /** v1.2.4 §A.2 — owner's Discord/Slack user id. Used by §4.5 owner-only
   *  gate. Optional — Step 3.5 prompt allows skip + first-message
   *  hydration fallback captures it on first owner message. */
  messengerUserId?: string;
}

/**
 * Resolve the Discord application from a bot token via
 * `GET /oauth2/applications/@me`. This is the only endpoint that returns the
 * application id for a bot token — `/users/@me` returns the bot *user* object
 * which has no such field. Returns null on any network/auth failure; callers
 * fall back to the bot user id (identical snowflake for Discord bots).
 *
 * Also surfaces `owner.id` — the Developer Portal account that owns the app,
 * usually the solo founder who will command the bot. Skipped for team-owned
 * apps (`team` populated): there `owner` is a synthetic team user, not the
 * person, so we don't want to seed the owner-only gate with it.
 */
async function fetchDiscordApplication(
  token: string,
): Promise<{ id: string; ownerUserId?: string } | null> {
  try {
    const res = await fetch(
      "https://discord.com/api/v10/oauth2/applications/@me",
      { headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      id?: string;
      owner?: { id?: string };
      team?: unknown;
    };
    if (typeof body.id !== "string" || body.id.length === 0) return null;
    const ownerUserId =
      body.team == null &&
      typeof body.owner?.id === "string" &&
      /^\d{17,20}$/.test(body.owner.id)
        ? body.owner.id
        : undefined;
    return { id: body.id, ownerUserId };
  } catch {
    return null;
  }
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
      };
      if (!body.id || !body.username) return null;
      // The `/users/@me` User object carries only the bot's *user* id — it
      // has no `application_id` field. (Reading a non-existent field is why
      // appId was always undefined pre-v1.2.9, silently skipping invite-URL
      // synthesis.) Resolve the canonical application (client) id from the
      // dedicated endpoint, falling back to the bot user id — for Discord
      // bots the two snowflakes are identical. The same call also yields the
      // app owner's user id, used to pre-fill the owner-only gate prompt.
      const app = await fetchDiscordApplication(token);
      return {
        handle: normalizeHandle(body.username),
        botUserId: body.id,
        appId: app?.id ?? body.id,
        ownerUserId: app?.ownerUserId,
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

  // v1.2.9 §3.1 — explicit Discord Application (Client) ID confirmation.
  // Auto-detected from the bot token above; we still surface it because it
  // is the load-bearing value for the OAuth invite URL. Enter accepts the
  // detected default. On detection failure (network down / wrong token) the
  // prompt lets the user paste it from Developer Portal → General
  // Information → Application ID, so the invite URL is no longer silently
  // skipped. Discord-only — Slack derives the invite differently.
  if (args.messenger === "discord") {
    console.log(
      chalk.bold(
        "\n  💡 Your Discord Application (Client) ID — used to build the server invite URL",
      ),
    );
    console.log(
      chalk.dim(
        extracted.appId
          ? `  - Auto-detected from your bot token: ${chalk.cyan(extracted.appId)}.\n` +
              `    Press Enter to accept, or override if you pasted the wrong app's token.`
          : `  - Developer Portal → General Information → "Application ID" → Copy.\n` +
              `    17~20-digit number. Without it I can't synthesize the invite URL.`,
      ),
    );
    const { appIdInput } = await inquirer.prompt([
      {
        name: "appIdInput",
        message: extracted.appId
          ? `Application ID (Enter = "${extracted.appId}"):`
          : "Application ID (Enter = skip, set later via `solosquad doctor --discord`):",
        type: "input",
        default: extracted.appId ?? "",
        validate: (v: string) => {
          const trimmed = v.trim();
          if (!trimmed) return true; // skip allowed
          return /^\d{17,20}$/.test(trimmed)
            ? true
            : "Discord Application ID is a 17~20 digit number (Developer Portal → General Information → Application ID).";
        },
      },
    ]);
    const chosenAppId = (appIdInput as string).trim();
    extracted.appId = chosenAppId || extracted.appId;
  }

  // v1.2.4 §A.2 — owner messenger user id prompt. Required for §4.5
  // owner-only gate (default ON for fresh installs). Pre-v1.2.4 the field
  // was never populated → gate fell open + warned at every bot start.
  //
  // Discord: enable Developer Mode (User Settings → Advanced → Developer
  // Mode) → right-click your own profile → Copy User ID. Slack: profile
  // → More → Copy member ID (or the api auth.test response).
  //
  // Optional — skip falls back to first-message hydration (the adapter
  // captures author.id from the first owner-eligible message and persists
  // to user.yaml). Manual prompt is preferred because hydration assumes
  // the first message is from the owner, which fails in noisy channels.
  //
  // v1.2.9 — for Discord we pre-fill this from the app owner's user id
  // (`application.owner.id`, fetched alongside the app id). For a solo
  // founder the Developer Portal account is the same person who commands
  // the bot, so Enter accepts. Detection is skipped for team-owned apps,
  // where the user still types it (or skips for first-message hydration).
  const detectedOwnerId =
    args.messenger === "discord" ? extracted.ownerUserId : undefined;
  console.log(
    chalk.bold("\n  💡 Your Discord User ID (for the owner-only command gate)"),
  );
  console.log(
    chalk.dim(
      detectedOwnerId
        ? `  - Auto-detected from your app's owner: ${chalk.cyan(detectedOwnerId)}.\n` +
            `    Press Enter to accept, or override if someone else will command the bot.`
        : `  - Discord: enable Developer Mode (Settings → Advanced → Developer Mode)\n` +
            `    then right-click your own avatar → "Copy User ID". 18~19-digit number.\n` +
            `  - Slack: profile → More menu → "Copy member ID" (Uxxxxxxxxx).\n` +
            `  - Press Enter to skip — the bot will capture it from your first message.`,
    ),
  );
  const { messengerUserId } = await inquirer.prompt([
    {
      name: "messengerUserId",
      message: detectedOwnerId
        ? `Your ${args.messenger} User ID (Enter = "${detectedOwnerId}"):`
        : `Your ${args.messenger} User ID (Enter = capture on first message):`,
      type: "input",
      default: detectedOwnerId ?? "",
      validate: (v: string) => {
        const trimmed = v.trim();
        if (!trimmed) return true; // skip allowed
        if (args.messenger === "discord") {
          return /^\d{17,20}$/.test(trimmed)
            ? true
            : "Discord User ID is a 17~20 digit number (right-click your avatar → Copy User ID).";
        }
        // slack
        return /^U[A-Z0-9]{6,}$/.test(trimmed)
          ? true
          : "Slack member ID starts with U + uppercase alphanumerics (e.g. U0ABCDEFG).";
      },
    },
  ]);

  return {
    handle: normalizeHandle(confirmHandle),
    bot: extracted,
    messengerUserId: (messengerUserId as string).trim() || undefined,
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
    // v1.2.4 §A.2 — owner messenger id when supplied at Step 3.5. Omitted
    // when user skipped; first-message hydration in the adapter will fill
    // it on the first owner-eligible message.
    ...(args.choice.messengerUserId
      ? { messenger_user_id: args.choice.messengerUserId }
      : {}),
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
  // NOTE: "agents" is intentionally NOT here — the v1.1 bundle block below
  // copies the canonical top-level agents/ (main/ + specialists/). The old
  // assets/agents/ team-nested roster was removed (v1.3.1 cleanup); copying
  // both used to pollute .solosquad/agents/ with two divergent taxonomies.
  const assetsDir = getAssetsDir();
  const assetDirs = ["routines", "core", "templates", "orchestrator"];
  fs.mkdirSync(solosquadDir, { recursive: true });
  for (const dir of assetDirs) {
    const src = path.join(assetsDir, dir);
    if (fs.existsSync(src)) {
      copyDirSync(src, path.join(solosquadDir, dir));
      console.log(` ${chalk.green("✓")} .solosquad/${dir}/`);
    }
  }

  // v1.1 bundle dirs (live at <bundle>/<dir>/, not under assets/). Copy
  // them into .solosquad/ so the workspace has the v1.1 layout
  // (agents/main/*, agents/specialists/*, skills/*, teams/*, schedules/*,
  // user/*, knowledge/*). Each is optional — the path resolvers in
  // util/paths.ts fall back to the bundle when the workspace copy is
  // absent. copyDirSync is "merge, don't clobber" (skips existing files)
  // so re-running init never overwrites user customizations.
  const { getBundleRoot } = await import("../util/paths.js");
  const bundleRoot = getBundleRoot();
  const v11Dirs = [
    "agents",
    "skills",
    "teams",
    "schedules",
    "user",
    "knowledge",
  ];
  for (const dir of v11Dirs) {
    const src = path.join(bundleRoot, dir);
    if (!fs.existsSync(src)) continue;
    copyDirSync(src, path.join(solosquadDir, dir));
    console.log(` ${chalk.green("✓")} .solosquad/${dir}/  ${chalk.dim("(v1.1)")}`);
  }

  // .env.example → .solosquad/.env (if missing)
  const envExampleSrc = path.join(assetsDir, ".env.example");
  const envDest = path.join(solosquadDir, ".env");
  if (fs.existsSync(envExampleSrc) && !fs.existsSync(envDest)) {
    fs.copyFileSync(envExampleSrc, envDest);
    console.log(` ${chalk.green("✓")} .solosquad/.env`);
  }

  // docker-compose.yml and Dockerfile at workspace root (sourced from assets/docker/)
  for (const f of ["docker-compose.yml", "Dockerfile"]) {
    const src = path.join(assetsDir, "docker", f);
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
  // v1.2.4 §A.3 — Slack 옵션은 picker 에서 임시 숨김 (v1.2.x adapter 슬롯
  // 활성화 시 복원). picker 단계 자체는 유지하여 향후 항목 추가 시 흐름이
  // 자연스럽게 확장되도록.
  const { messenger } = await inquirer.prompt([
    {
      name: "messenger",
      message: "Messenger platform:",
      type: "list",
      choices: [
        { name: "Discord — v1.2 default (1 Chief bot per org, OAuth invite URL 1-click)", value: "discord" },
        {
          name: "Slack   — (coming back in v1.2.x — temporarily hidden)",
          value: "slack",
          disabled: "post-v1.0 슬롯, v1.2.x adapter 활성화 후 복원",
        },
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
    console.log("  Bot permissions: View Channels, Send Messages, Read Message History, Create Public Threads");
    console.log(
      chalk.dim(
        "\n  v1.2 tip: when Discord asks for the Bot's name on the Developer Portal page,",
      ),
    );
    console.log(
      chalk.dim(
        "  use the same string you'll pick as the Chief name (Step 6 below). Keeping",
      ),
    );
    console.log(
      chalk.dim(
        "  them identical means the messenger surface and SoloSquad's narration match.\n",
      ),
    );
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
      // v1.2.9 §E — dev mode ON by default: agents may write files + run git
      // (push / pr-merge excluded). Toggle later via /grant · /revoke.
      dev_capability: { enabled: true },
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

    // v1.2 §4.1 — org-level Chief display name. v1.2.4 §B.3 — copy
    // 보강. Chief 이름은 다음 표면에서 노출됨:
    //   1. 봇 응답 prefix              `[Hermes]` (Discord/Slack 메시지)
    //   2. guildCreate onboarding embed `안녕하세요, Hermes 입니다 🫡`
    //   3. works 채널 task card footer  `Hermes · Chief`
    //   4. owner-only 게이트 ephemeral  `Hermes only takes commands from <@owner>`
    //   5. doctor / log 출력            `Chief name: Hermes`
    //   6. Discord Developer Portal Bot 이름 권장 동일 (메신저 표면 일관성)
    //
    // Skip = runtime fallback `"Chief"`. 동작은 정상이지만 정체성 약함.
    console.log(
      chalk.bold("\n  💡 Chief 이름 — 조직 1개당 1명, 사용자 대면 supervisor"),
    );
    console.log(
      chalk.dim(
        "  Chief 는 사용자가 메신저에서 직접 대화하는 유일한 에이전트입니다.\n" +
          "  4 main bot (pm / engineer / designer / marketer) + 20 specialist 를\n" +
          "  내부적으로 spawn 해서 결과를 합성 → 사용자에게는 *Chief 1명* 으로 보임.\n" +
          "\n  이름은 다음 6곳에 노출됩니다:\n" +
          "    • 봇 응답 prefix         [Hermes]\n" +
          "    • Discord onboarding embed  안녕하세요, Hermes 입니다 🫡\n" +
          "    • works 채널 task card    Hermes · Chief\n" +
          "    • owner-only 안내 메시지   Hermes only takes commands from @you\n" +
          "    • doctor / log 출력\n" +
          "    • Discord Developer Portal Bot 이름 권장 동일\n" +
          "\n  추천 예시: Hermes, Atlas, Apollo, Iris, Janus, Athena, Hephaestus.\n" +
          `  Step 3 에서 Discord Bot 을 만들었으면 같은 이름을 쓰세요.`,
      ),
    );
    const { chiefName } = await inquirer.prompt([
      {
        name: "chiefName",
        message: "Chief name (blank = use default \"Chief\"):",
        type: "input",
        default: "",
      },
    ]);
    const trimmedChief = (chiefName as string).trim() || undefined;

    const { orgDir } = scaffoldOrg({
      workspace,
      name: orgName,
      provider,
      remoteUrl: remoteUrl || null,
      messenger,
      chiefName: trimmedChief,
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
      "  Need to clone? Run `git clone <url> <path>` first, then re-add the path here.\n" +
      "\n" +
      "  💡 Path tips:\n" +
      "    • 따옴표 없이 붙여넣기 (Explorer / PowerShell 의 'Copy as path' 는 \" \" 가 붙음 — 자동 strip 되지만 안 붙이는 편이 안전)\n" +
      "    • Windows: C:\\\\Dev\\\\my-repo 또는 C:/Dev/my-repo 모두 OK\n" +
      "    • macOS / Linux: /Users/you/Code/my-repo"
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

    // v1.2 §3.1 / §5 Step 4 — auto-print the Discord invite URL right after
    // the user yaml is saved. The user clicks once → Discord OAuth →
    // bot joins their guild → guildCreate handler (v1.2 §5) onboards them.
    // Skipped silently when bot_application_id wasn't recovered from the
    // token (token invalid / network down — promptHandleSelection already
    // warned).
    if (
      messengerPlatform === "discord" &&
      identityChoice?.bot.appId
    ) {
      const { buildInviteUrl, openInBrowser } = await import(
        "../messenger/discord-invite-url.js"
      );
      try {
        const url = buildInviteUrl({
          applicationClientId: identityChoice.bot.appId,
        });
        console.log(chalk.bold("\n-- Discord Invite URL --"));
        console.log(
          chalk.dim(
            "  Click once to add your Chief bot to a guild. Discord will ask which server",
          ),
        );
        console.log(
          chalk.dim(
            "  to add it to and which permissions to grant — keep the defaults.",
          ),
        );
        console.log("");
        console.log(chalk.cyan(`  ${url}`));
        if (openInBrowser(url)) {
          console.log(chalk.dim("  → opened in your default browser"));
        } else {
          console.log(
            chalk.yellow(
              "  ⚠ Could not launch a browser automatically — copy the URL above.",
            ),
          );
        }
      } catch (err) {
        console.log(
          chalk.yellow(
            `  ⚠ Invite URL synthesis failed: ${(err as Error).message}`,
          ),
        );
        console.log(
          chalk.dim("    Run `solosquad discord invite-url` later to retry."),
        );
      }
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
  console.log(
    `\n  ${chalk.bold("dev 모드:")} ${chalk.green("ON")} — 에이전트가 파일 작성·git(push 제외)을 수행합니다.`,
  );
  console.log(
    chalk.dim("  디스코드/터미널에서 /revoke 로 끄고, /grant 로 다시 켤 수 있습니다."),
  );

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
