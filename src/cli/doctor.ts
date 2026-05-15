import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  loadEnv,
  loadProducts,
  loadWorkspaceYaml,
  listOrganizations,
} from "../util/config.js";
import {
  commandExists,
  IS_WINDOWS,
  platformInfo,
  shellName,
} from "../util/platform.js";
import { getWorkspaceRoot } from "../util/paths.js";
import { listUserYamls, type UserYaml } from "../bot/user-registry.js";
import { loadMessengerSection } from "../messenger/broadcast.js";

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

  // 4.5. Multi-user messenger (v0.8)
  if (isNew) {
    console.log(chalk.dim("\nMulti-user messenger (v0.8):"));
    issues += await runMultiUserChecks(workspace, messenger, messengerCheck);
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
  const { readLock, isStaleLock, uninstallLockPath, logoutLockPath } = await import(
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

  // Logout lock?
  if (fs.existsSync(logoutLockPath(workspace))) {
    warn(
      "logout.lock present",
      "solosquad bot/schedule/pm will refuse to start until removed",
    );
  }

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

// -- Multi-user messenger (v0.8) --

async function runMultiUserChecks(
  workspace: string,
  messenger: string,
  messengerCheck: boolean | undefined,
): Promise<number> {
  let failures = 0;

  // workspace.yaml must be 0.8.x for these checks to be authoritative.
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) {
    warn("workspace.yaml missing — skip v0.8 checks");
    return 0;
  }

  const orgs = listOrganizations(workspace);
  if (orgs.length === 0) {
    warn("No organizations registered", "Run `solosquad add org <name>`");
    return 0;
  }

  // Per-org user yaml presence.
  let totalUsers = 0;
  const allUsers: Array<{ orgSlug: string; user: UserYaml }> = [];
  for (const org of orgs) {
    const users = listUserYamls(org.slug, workspace);
    if (users.length === 0) {
      if (!check(
        `${org.slug}: ≥1 user yaml`,
        false,
        "Run `solosquad init` or `solosquad migrate --apply` (0.7→0.8)",
      )) {
        failures++;
      }
      continue;
    }
    check(`${org.slug}: ${users.length} user yaml(s)`, true);
    totalUsers += users.length;
    for (const u of users) allUsers.push({ orgSlug: org.slug, user: u });
  }

  // Optional live messenger API match: bot_user_id from .env token must match
  // exactly one yaml's bot_user_id.
  if (messengerCheck && messenger && allUsers.length > 0) {
    if (messenger.includes("discord")) {
      const token = process.env.DISCORD_TOKEN;
      if (!isPlaceholder(token)) {
        try {
          const res = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bot ${token}` },
          });
          if (res.ok) {
            const body = (await res.json()) as { id?: string; username?: string };
            const matched = allUsers.find(
              ({ user }) => user.bot_user_id === body.id,
            );
            if (matched) {
              check(
                `Discord bot_user_id matches yaml (handle=${matched.user.handle}, org=${matched.orgSlug})`,
                true,
              );
            } else {
              if (
                !check(
                  "Discord bot_user_id ↔ user yaml",
                  false,
                  `id=${body.id ?? "?"} (${body.username ?? "?"}) does not match any registered user`,
                )
              ) {
                failures++;
              }
            }
          }
        } catch {
          // ignore — surface via primary messenger check
        }
      }
    }
    if (messenger.includes("slack")) {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!isPlaceholder(token)) {
        try {
          const res = await fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = (await res.json()) as {
            ok?: boolean;
            user?: string;
            user_id?: string;
          };
          if (body.ok && body.user_id) {
            const matched = allUsers.find(
              ({ user }) => user.bot_user_id === body.user_id,
            );
            if (matched) {
              check(
                `Slack bot_user_id matches yaml (handle=${matched.user.handle}, org=${matched.orgSlug})`,
                true,
              );
            } else {
              if (
                !check(
                  "Slack bot_user_id ↔ user yaml",
                  false,
                  `id=${body.user_id} (${body.user ?? "?"}) does not match any registered user`,
                )
              ) {
                failures++;
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Broadcast designation consistency: handle must exist somewhere when set.
  const section = loadMessengerSection(workspace);
  if (section.broadcast_enabled === true) {
    const owner = section.broadcast_owner_handle ?? null;
    if (!owner) {
      if (
        !check(
          "broadcast_enabled=true but broadcast_owner_handle is null",
          false,
          "Run `solosquad messenger broadcast-handover --to <handle>`",
        )
      ) {
        failures++;
      }
    } else {
      const found = allUsers.some(({ user }) => user.handle === owner);
      if (!found) {
        if (
          !check(
            `broadcast_owner_handle=${owner} not registered`,
            false,
            "Handover to a registered user",
          )
        ) {
          failures++;
        }
      } else {
        check(`broadcast designation: ${owner}`, true);
      }
    }
  } else {
    check("broadcast_enabled=false (opt-in)", true);
  }

  void totalUsers;
  return failures;
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
