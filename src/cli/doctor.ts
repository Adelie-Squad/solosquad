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
import { detectWorkspaceVersion } from "../migrations/detect.js";
import { fileURLToPath } from "url";

const __dirname_doctor = path.dirname(fileURLToPath(import.meta.url));

/**
 * v0.8.3 §7.3 — resolve the installed CLI version. Walks up from this
 * compiled file (dist/src/cli/doctor.js or src/cli/doctor.ts during dev)
 * to find package.json. Returns null only when invoked outside the npm
 * package tree (should never happen in production).
 */
function resolveCliVersion(): string | null {
  let candidate = path.resolve(__dirname_doctor, "..", "..", "package.json");
  if (!fs.existsSync(candidate)) {
    candidate = path.resolve(__dirname_doctor, "..", "..", "..", "package.json");
  }
  if (!fs.existsSync(candidate)) return null;
  try {
    const raw = fs.readFileSync(candidate, "utf-8");
    const obj = JSON.parse(raw) as { version?: string };
    return obj.version ?? null;
  } catch {
    return null;
  }
}

/**
 * v0.8.3 §7.3 — semver compare ignoring pre-release/build labels.
 * Returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): number[] =>
    s.split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * v0.8.3 §7.3 — given CLI + workspace version strings, decide which
 * remedy to recommend. Exported for unit tests.
 */
export type VersionRecommendation =
  | { kind: "ok" }
  | { kind: "migrate"; cliVersion: string; workspaceVersion: string }
  | { kind: "update"; cliVersion: string; workspaceVersion: string };

export function recommendForVersionMismatch(
  cliVersion: string,
  workspaceVersion: string,
): VersionRecommendation {
  const cmp = compareSemver(cliVersion, workspaceVersion);
  if (cmp === 0) return { kind: "ok" };
  if (cmp > 0) {
    // CLI newer than workspace → user upgraded CLI, needs to migrate workspace
    return { kind: "migrate", cliVersion, workspaceVersion };
  }
  // CLI older than workspace → user has a newer workspace layout, needs to update CLI
  return { kind: "update", cliVersion, workspaceVersion };
}

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

  // 2. Workspace layout detection — v0.2.2 has .solosquad/, v0.1.x has flat config dirs
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

    // v0.8.3 §7.3 — CLI ↔ workspace version mismatch advisory.
    const cliVersion = resolveCliVersion();
    const wsVersion = fs.existsSync(wsYaml) ? detectWorkspaceVersion(workspace) : null;
    if (cliVersion && wsVersion) {
      const rec = recommendForVersionMismatch(cliVersion, wsVersion);
      if (rec.kind === "ok") {
        check(`CLI v${cliVersion} == workspace v${wsVersion}`, true);
      } else if (rec.kind === "migrate") {
        warn(
          `CLI v${cliVersion} > workspace v${wsVersion}`,
          "Run: solosquad migrate --apply  (upgrade workspace layout to match CLI)",
        );
      } else {
        warn(
          `CLI v${cliVersion} < workspace v${wsVersion}`,
          "Run: npm install -g solosquad@latest  (or solosquad update — workspace was migrated by a newer CLI)",
        );
      }
    }
  } else if (legacyMarkers) {
    warn(
      `Legacy v0.1.x layout at ${workspace}`,
      "Run: solosquad migrate --dry-run  (preview),  --apply  (upgrade to v0.2.0)"
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
      "v0.2.0+ supports only one messenger per workspace. Using first value."
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

  // 4. Lifecycle (v0.7)
  if (isNew) {
    console.log(chalk.dim("\nLifecycle (v0.7):"));
    issues += await runLifecycleChecks(workspace);
  }

  // 5. Live messenger API check (opt-in)
  if (messengerCheck && messenger) {
    console.log(chalk.dim("\nMessenger API check:"));
    issues += await runMessengerChecks(messenger);
  }

  // 6. Summary
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

// -- Lifecycle (v0.7) --

async function runLifecycleChecks(workspace: string): Promise<number> {
  const failures = 0;
  const os = await import("os");
  const { readLock, isStaleLock, uninstallLockPath } = await import(
    "../lifecycle/lockfile.js"
  );
  const { _precheckInternals } = await import("../lifecycle/precheck.js");

  // npm uninstall warning (informational)
  warn(
    "npm v7+ has no global uninstall hook (npm/cli#3042)",
    "Run `solosquad uninstall` BEFORE `npm uninstall -g solosquad`",
  );

  // Stale uninstall.lock?
  const ulock = uninstallLockPath(workspace);
  const ulockInfo = readLock(ulock);
  if (ulockInfo && isStaleLock(ulock)) {
    warn(
      "stale uninstall.lock detected",
      `pid ${ulockInfo.pid} not alive — will be cleared on next acquire`,
    );
  } else if (ulockInfo) {
    warn(
      "uninstall.lock held",
      `pid ${ulockInfo.pid}, started ${ulockInfo.startTs}`,
    );
  }

  // v0.8.3 — `solosquad logout` removed (§6.1). logout.lock check eliminated.

  // Live PM/scheduler processes
  const livePids = _precheckInternals.detectLivePids();
  if (livePids.length > 0) {
    warn(
      `solosquad bot/schedule processes alive (pid ${livePids.join(", ")})`,
      "Stop these before `solosquad uninstall` to keep archive snapshot consistent",
    );
  }

  // Archive home dir free space (informational)
  const archiveHome = os.homedir();
  type StatFs = { bsize: number; bavail: number };
  const statFn = (fs as unknown as { statfsSync?: (p: string) => StatFs }).statfsSync;
  if (statFn) {
    try {
      const s = statFn(archiveHome);
      const freeBytes = s.bavail * s.bsize;
      const freeMb = freeBytes / 1024 / 1024;
      if (freeMb < 200) {
        warn(
          `low free space at ${archiveHome}: ${freeMb.toFixed(0)} MB`,
          "Need workspace size × 1.5 for archive",
        );
      } else {
        check(`archive destination free space: ${humanBytesDoctor(freeBytes)}`, true);
      }
    } catch {
      // ignore
    }
  }

  return failures;
}

function humanBytesDoctor(n: number): string {
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
    check(
      "Telegram",
      false,
      "Telegram support was removed in v0.2.4. Switch MESSENGER to discord or slack."
    );
    failures++;
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

