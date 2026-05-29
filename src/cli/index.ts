import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { detectWorkspaceVersion, findWorkspaceRoot } from "../migrations/detect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Walk up from dist/src/cli/ or src/cli/ to find package.json
let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
if (!fs.existsSync(pkgPath)) {
  pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

const LAYOUT_BANNER_SKIP = new Set([
  "migrate",
  "update",
  "doctor",
  "help",
  "check",
]);

/**
 * Compare two version strings. Returns negative if a < b, 0 if equal, positive if a > b.
 * Handles "x" wildcards in either position (treated as 0).
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p) || 0);
  const pb = b.split(".").map((p) => parseInt(p) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Print a banner if the workspace layout is behind the installed CLI.
 * Fires on any subcommand except migrate/update/doctor (to avoid noise).
 */
function printLayoutMismatchBanner(cliVersion: string): void {
  const wsRoot = findWorkspaceRoot(process.cwd());
  if (!wsRoot) return;

  const wsVersion = detectWorkspaceVersion(wsRoot);
  if (!wsVersion) return;

  // Layout behind CLI → banner
  if (compareVersions(wsVersion, cliVersion) < 0) {
    console.log(
      chalk.yellow("\n  ⚠ Workspace layout is behind the installed CLI.")
    );
    console.log(
      chalk.dim(`    Workspace: v${wsVersion}   CLI: v${cliVersion}`)
    );
    console.log(
      chalk.yellow("    Run a migration before continuing:")
    );
    console.log(chalk.cyan("      solosquad migrate --dry-run   (preview)"));
    console.log(chalk.cyan("      solosquad migrate --apply     (perform)\n"));
  }
}

export const program = new Command()
  .name("solosquad")
  .version(pkg.version)
  .description("24/7 AI assistant system for solo founders")
  .hook("preAction", (thisCommand, actionCommand) => {
    const name = actionCommand.name();
    if (LAYOUT_BANNER_SKIP.has(name)) return;
    printLayoutMismatchBanner(pkg.version);
  });

program
  .command("init")
  .description("Initialize workspace (setup wizard)")
  .action(async () => {
    const { initCommand } = await import("./init.js");
    await initCommand();
  });

program
  .command("bot")
  .description("Start messenger bot")
  .option(
    "--supervise",
    "v1.2.8 — wrap the bot in a supervisor that auto-respawns on clean exit. Pairs with `solosquad migrate --apply` (which signals SIGTERM to the running bot) so users don't have to Ctrl+C + re-run after every migration. Cloud users with PM2 / systemd / Docker don't need this — their manager already restarts.",
  )
  .action(async (opts) => {
    if (opts.supervise) {
      const { runBotSupervisor } = await import("./bot-supervise.js");
      await runBotSupervisor();
      return;
    }
    const { startBot } = await import("../bot/index.js");
    await startBot();
  });

program
  .command("schedule")
  .description("Start automated scheduler")
  .action(async () => {
    const { startScheduler } = await import("../scheduler/index.js");
    await startScheduler();
  });

program
  .command("status")
  .description("Show project dashboard")
  .action(async () => {
    const { statusCommand } = await import("./status.js");
    statusCommand();
  });

program
  .command("update")
  .description("Check for updates and self-update")
  .option("--channel <channel>", "Release channel: stable | dev", "stable")
  .action(async (opts) => {
    const { updateCommand } = await import("./update.js");
    await updateCommand(opts.channel);
  });

program
  .command("doctor")
  .description("Check environment and diagnose issues")
  .option("--ci", "CI mode: exit with non-zero code on failure, no color")
  .option("--messenger-check", "Validate messenger tokens against live APIs (Slack/Discord)")
  .option("--discord", "v1.2 — run the focused Discord 5-hop diagnostic instead of the full sweep")
  .action(async (opts) => {
    if (opts.discord) {
      const { doctorDiscordCommand } = await import("./doctor-discord.js");
      await doctorDiscordCommand({ ci: opts.ci });
      return;
    }
    const { doctorCommand } = await import("./doctor.js");
    await doctorCommand(opts.ci, opts.messengerCheck);
  });

const readinessGroup = program
  .command("readiness")
  .description("Readiness checks (v0.6+)");

readinessGroup
  .command("check")
  .description("Check workspace data readiness for a target version (v0.6 §6)")
  .option("--target <version>", "Target version to check readiness for", "v0.6")
  .action(async (opts) => {
    const { readinessCheckCommand } = await import("./readiness.js");
    await readinessCheckCommand({ target: opts.target });
  });

program
  .command("run-routine")
  .description("Run a routine manually")
  .argument("[routine-id]", "Routine ID (e.g. signal-scan)")
  .option("-a, --all", "Run all routines")
  .action(async (routineId, opts) => {
    const { runRoutineCommand } = await import("./run-routine.js");
    await runRoutineCommand(routineId, opts.all);
  });

// `solosquad run` (autonomous program runner) lives on the v0.4 branch.

const addGroup = program
  .command("add")
  .description("Add an organization or repository to the workspace");

addGroup
  .command("org")
  .description("Add another organization to this workspace")
  .argument("[name]", "Organization name (blank = interactive)")
  .option("--provider <provider>", "local | github | gitlab | gitea")
  .option("--remote-url <url>", "Remote URL for the organization")
  .option("--messenger <platform>", "Override workspace messenger for this org's channels")
  .option("--chief-name <name>", "Chief display name (v1.2 — blank = use default \"Chief\")")
  .option("--skip-discord", "Skip the inline Discord invite-URL prompt")
  .action(async (name, opts) => {
    const { addOrgCommand } = await import("./add-org.js");
    await addOrgCommand(name, opts);
  });

addGroup
  .command("repo")
  .description("Add a repository (clone a URL or register an existing local path)")
  .argument("[input]", "Git URL or local path")
  .option("--org <slug>", "Target organization slug (auto-picked if only one)")
  .option("--role <role>", "main | frontend | backend | data | infra | docs | unknown")
  .option("--slug <slug>", "Override the repo folder name")
  .option("--from-report <path>", "Apply a previously generated analyze report (v0.5)")
  .option(
    "--merge-policy <policy>",
    "append | override | replace — role-label merge strategy (default append)"
  )
  .option("--dry-run", "Simulate the move (v0.8.3) — print risk report, write nothing")
  .option("--inspect", "[deprecated] use --dry-run")
  .option("--keep-original", "Copy the repo into the workspace instead of moving (v0.8.3)")
  .option("--path <external>", "v0.9.1 — register external repo as path-reference (no move, no copy). Default mode when cwd is a git repo and [input] is omitted.")
  .action(async (input, opts) => {
    const { addRepoCommand } = await import("./add-repo.js");
    await addRepoCommand(input, opts);
  });

const analyzeGroup = program
  .command("analyze")
  .description("Analyze existing assets for SoloSquad onboarding (v0.5)");

analyzeGroup
  .command("repo")
  .description("Scan a repo's .claude/skills/, classify, and write a Markdown report")
  .argument("<path>", "Path to the repository to analyze")
  .option("--force", "Re-classify every file (drop existing ledger cache)")
  .option("--prune-orphans", "Remove ledger entries whose files have disappeared")
  .action(async (repoPath, opts) => {
    const { analyzeRepoCli } = await import("./analyze.js");
    await analyzeRepoCli(repoPath, opts);
  });

program
  .command("sync")
  .description("Sync org/repositories/ folders with .org.yaml (detects legacy layout)")
  .option("--org <slug>", "Only sync a specific organization")
  .option("--dry-run", "Show what would change without writing")
  .action(async (opts) => {
    const { syncCommand } = await import("./sync.js");
    await syncCommand(opts);
  });

const pmGroup = program
  .command("pm")
  .description("Manage PM sessions (v0.3.0+)");

pmGroup
  .command("status")
  .description("Show active PM sessions, cumulative cost, and activity")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (opts) => {
    const { pmStatusCommand } = await import("./pm.js");
    await pmStatusCommand(opts);
  });

pmGroup
  .command("reset")
  .description("Archive a user's PM session and mint a new one")
  .option("--org <slug>", "Organization slug (auto-picked if only one)")
  .option("--user <id>", "User id to reset (interactive picker if omitted)")
  .option("--reason <text>", "Reason for the rotation", "user-requested")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const { pmResetCommand } = await import("./pm.js");
    await pmResetCommand(opts);
  });

pmGroup
  .command("compact")
  .description("Run pm-compaction routine to externalize completed workflows")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (opts) => {
    const { pmCompactCommand } = await import("./pm.js");
    await pmCompactCommand(opts);
  });

const workflowGroup = program
  .command("workflow")
  .description("Inspect workflows + their stages");

workflowGroup
  .command("list")
  .description("List all workflows in the workspace (or for one org)")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (opts) => {
    const { workflowListCommand } = await import("./workflow.js");
    await workflowListCommand(opts);
  });

workflowGroup
  .command("show")
  .description("Show a specific workflow's stages + recent events")
  .argument("<workflow-id>", "Workflow id (e.g. wf-2026-05-12-landing-refresh)")
  .option("--org <slug>", "Restrict to a specific organization")
  .option("--events <n>", "Number of recent events to show", (v) => parseInt(v, 10), 8)
  .action(async (workflowId, opts) => {
    const { workflowShowCommand } = await import("./workflow.js");
    await workflowShowCommand(workflowId, opts);
  });

workflowGroup
  .command("focus")
  .description("Set the active workflow for a user's PM session (or --clear)")
  .argument("[workflow-id]", "Workflow id to focus on; omit when using --clear")
  .option("--org <slug>", "Organization slug (auto-picked if only one)")
  .option("--user <id>", "User id (interactive picker if omitted)")
  .option("--clear", "Clear focus instead of setting it")
  .action(async (workflowId, opts) => {
    const { workflowFocusCommand } = await import("./workflow-focus.js");
    await workflowFocusCommand(workflowId, opts);
  });

const goalGroup = program
  .command("goal")
  .description("Autonomous goal runs (v0.4)");

goalGroup
  .command("new")
  .description("Scaffold a new goal.md from the template")
  .argument("[goal-id]", "Kebab-case goal id (e.g. landing-cvr-optim)")
  .option("--org <slug>", "Organization slug (auto-picked if only one)")
  .action(async (goalId, opts) => {
    const { goalNewCommand } = await import("./goal.js");
    await goalNewCommand(goalId, opts);
  });

goalGroup
  .command("list")
  .description("List all goals in the workspace (or for one org)")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (opts) => {
    const { goalListCommand } = await import("./goal.js");
    await goalListCommand(opts);
  });

goalGroup
  .command("show")
  .description("Show a specific goal's spec + recent cycles")
  .argument("<goal-id>", "Goal id")
  .option("--org <slug>", "Restrict to a specific organization")
  .option("--events <n>", "Number of recent cycle rows to show", (v) => parseInt(v, 10), 8)
  .action(async (goalId, opts) => {
    const { goalShowCommand } = await import("./goal.js");
    await goalShowCommand(goalId, opts);
  });

goalGroup
  .command("run")
  .description("Run a goal autonomously (background session + cycle loop)")
  .argument("<goal-id>", "Goal id")
  .option("--org <slug>", "Organization slug (auto-picked if only one)")
  .option("--hours <n>", "Override time budget (hours)")
  .option("--cycles <n>", "Override cycle budget")
  .action(async (goalId, opts) => {
    const { goalRunCommand } = await import("./goal.js");
    await goalRunCommand(goalId, opts);
  });

goalGroup
  .command("status")
  .description("Show status of one or all goals (cycle counts, cost, ship candidate)")
  .argument("[goal-id]", "Optional — restrict to one goal")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (goalId, opts) => {
    const { goalStatusCommand } = await import("./goal.js");
    await goalStatusCommand(goalId, opts);
  });

goalGroup
  .command("stop")
  .description("Stop an in-flight goal run (current cycle finishes; next won't start)")
  .argument("<goal-id>", "Goal id")
  .option("--org <slug>", "Organization slug")
  .action(async (goalId, opts) => {
    const { goalStopCommand } = await import("./goal.js");
    await goalStopCommand(goalId, opts);
  });

goalGroup
  .command("verify")
  .description("Re-run the evaluator on a past cycle and check determinism")
  .argument("<goal-id>", "Goal id")
  .requiredOption("--cycle <n>", "Cycle number to verify")
  .option("--org <slug>", "Organization slug")
  .action(async (goalId, opts) => {
    const { goalVerifyCommand } = await import("./goal.js");
    await goalVerifyCommand(goalId, opts);
  });

goalGroup
  .command("queue")
  .description("Enqueue a goal for the org (1-active-per-org semaphore, v1.1)")
  .argument("<goal-id>", "Goal id")
  .option("--org <slug>", "Organization slug")
  .action(async (goalId, opts) => {
    const { goalQueueCommand } = await import("./goal.js");
    await goalQueueCommand(goalId, opts);
  });

goalGroup
  .command("active")
  .description("Show the active goal + queue for the org (v1.1)")
  .option("--org <slug>", "Organization slug")
  .action(async (opts) => {
    const { goalActiveCommand } = await import("./goal.js");
    await goalActiveCommand(opts);
  });

goalGroup
  .command("next")
  .description("Promote the head of the queue to active if slot is free (v1.1)")
  .option("--org <slug>", "Organization slug")
  .action(async (opts) => {
    const { goalNextCommand } = await import("./goal.js");
    await goalNextCommand(opts);
  });

program
  .command("rollback")
  .description("Revert <org>/memory and <org>/workflows to an earlier snapshot")
  .option("--org <slug>", "Organization slug (auto-picked if only one)")
  .option("--workflow <id>", "Filter snapshots to a specific workflow")
  .option("--to <sha>", "Target snapshot SHA (defaults to last pre-spawn)")
  .option("--list", "List snapshot history instead of reverting")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const { rollbackCommand } = await import("./rollback.js");
    await rollbackCommand(opts);
  });

program
  .command("migrate")
  .description("Migrate workspace to the current SoloSquad version")
  .option("--dry-run", "Preview the migration without applying it (default)")
  .option("--apply", "Actually apply the migration")
  .option("--rollback", "Restore a workspace from a previous backup")
  .option("--list-backups", "[deprecated] use `solosquad backup list`")
  .option("--delete-backup <id>", "[deprecated] use `solosquad backup delete <id>`")
  .option("--to <version>", "Target version (default: current CLI version)")
  .action(async (opts) => {
    const { migrateCommand } = await import("./migrate.js");
    await migrateCommand(opts);
  });

const memoryGroup = program
  .command("memory")
  .description("Inspect the FTS5 cold archive (v0.6)");

memoryGroup
  .command("search")
  .description("Full-text search across past routine logs + router/author/spawn events")
  .argument("<query>", "Search query (whitespace-separated terms; quotes/specials stripped)")
  .option("--limit <n>", "Maximum number of hits to print", "10")
  .option(
    "--event-type <type>",
    "Restrict to one of: routine_log | route_hit | route_miss | author_turn | spawn_decision"
  )
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (query, opts) => {
    const { memorySearchCommand } = await import("./memory.js");
    await memorySearchCommand(query, opts);
  });

memoryGroup
  .command("stats")
  .description("Show row counts, oldest/newest, per-event-type breakdown")
  .option("--disk", "Include database file size on disk")
  .option("--org <slug>", "Filter to a specific organization")
  .action(async (opts) => {
    const { memoryStatsCommand } = await import("./memory.js");
    await memoryStatsCommand(opts);
  });

const agentGroup = program
  .command("agent")
  .description("Manage SKILL.md agents (v0.5)");

agentGroup
  .command("validate")
  .description("Validate a SKILL.md against the v0.5 schema")
  .argument("[path]", "Path to a SKILL.md file (omit when using --all)")
  .option("--all", "Validate every bundled + workspace SKILL.md")
  .action(async (filePath, opts) => {
    const { agentValidateCommand } = await import("./agent.js");
    await agentValidateCommand(filePath, opts);
  });

agentGroup
  .command("add")
  .description("Scaffold a new SKILL.md (no LLM) — fill in the body afterward")
  .requiredOption("--name <name>", "Agent name (kebab-case slug)")
  .requiredOption("--team <team>", "Team folder (strategy, growth, experience, engineering, …)")
  .option("--org <org>", "Write under <org>/.agents/ instead of workspace agents dir")
  .option("--description <text>", "Short description for frontmatter")
  .action(async (opts) => {
    const { agentAddCommand } = await import("./agent.js");
    try {
      await agentAddCommand(opts);
    } catch {
      // Error already printed by agentAddCommand; exit code set there.
    }
  });

agentGroup
  .command("reload")
  .description("Manually rebuild the router (v0.6 §10.5 — manual fs_watch.mode)")
  .option("--org <slug>", "Restrict reload to a specific org's .agents/ tier")
  .action(async (opts) => {
    const { agentReloadCommand } = await import("./agent.js");
    await agentReloadCommand(opts);
  });

program
  .command("uninstall")
  .description("Archive accumulated knowledge then remove SoloSquad assets (v0.7)")
  .option(
    "--mode <mode>",
    "full | keep | archive-only — what to do after archiving (default: full)",
    "full",
  )
  .option("--dry-run", "Preview without writing anything to disk")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--force", "Bypass blockers (live processes, workspace-as-git-tree, etc.)")
  .option("--archive-path <path>", "Override default archive zip path")
  // v0.8.4 — deprecated aliases. Removed in v1.0. See src/util/deprecation.ts.
  .option("--archive-only", "[deprecated] use --mode archive-only")
  .option("--keep-workspace", "[deprecated] use --mode keep")
  .option("--also-purge-backups", "[deprecated] use `solosquad backup purge`")
  .action(async (opts) => {
    const { uninstallCommand } = await import("./uninstall.js");
    await uninstallCommand(opts);
  });

// `solosquad logout` removed in v0.8.3 (§6.1). Use Ctrl+C to stop the bot,
// then `solosquad uninstall --archive-only` to clear credentials when you
// actually want to wind a workspace down.

program
  .command("logs")
  .description("Tail SoloSquad logs (runtime + operational jsonl) — v0.8.3")
  .option("--level <level>", "error | warn | info | debug")
  .option("--tail <n>", "Show the last N lines (default 50)", "50")
  .option("--follow", "Stream new lines as they arrive (Ctrl+C to stop)")
  .option("--since <when>", 'Only show lines since "1 hour ago" / ISO timestamp')
  .option(
    "--type <type>",
    "runtime | costs | spawn | stop-hook | dev-confirm | migration (repeatable)",
    (value: string, accum: string[] = []) => [...accum, value],
    [] as string[],
  )
  .option("--org <slug>", "Restrict per-org streams to a specific organization")
  .action(async (opts) => {
    const { logsCommand } = await import("./logs.js");
    await logsCommand(opts);
  });

// v0.8 — Multi-user messenger ops.
const messengerGroup = program
  .command("messenger")
  .description("Messenger model ops (v0.8 multi-user)");

messengerGroup
  .command("broadcast-handover")
  .description("Reassign the designated broadcaster bot (workspace.yaml)")
  .requiredOption("--to <handle>", "Target user handle (lowercase a-z, 0-9, _)")
  .option("--enable", "Also set broadcast_enabled: true")
  .action(async (opts) => {
    const { broadcastHandoverCommand } = await import("./messenger.js");
    await broadcastHandoverCommand({ to: opts.to, enable: opts.enable });
  });

// v1.2 §3.1 — Discord auto-connect ops.
const discordGroup = program
  .command("discord")
  .description("Discord auto-connect ops (v1.2)");

discordGroup
  .command("invite-url")
  .description("Synthesize an OAuth invite URL for the Chief bot and open it in a browser")
  .option("--client-id <id>", "Override the auto-detected application client_id")
  .option("--print-only", "Only print the URL — skip browser-open")
  .option("--org <slug>", "Restrict to one org when the workspace has many")
  .action(async (opts) => {
    const { inviteUrlCommand } = await import("./discord.js");
    await inviteUrlCommand({
      clientId: opts.clientId,
      printOnly: opts.printOnly,
      org: opts.org,
    });
  });

// v0.8.1 §4 — `solosquad import <archive.zip>`
program
  .command("import")
  .description("Restore a v0.7+ farewell archive into a workspace (v0.8.1)")
  .argument("<archive>", "Path to archive.zip (zip-v1 format)")
  .option("--workspace <path>", "Target workspace path (defaults to CWD or new folder)")
  .option("--into <org-slug>", "Map all archive orgs into this org slug")
  .option("--dry-run", "Show what would happen without writing")
  .option(
    "--mode <mode>",
    "merge | replace — conflict policy (default: merge)",
    "merge",
  )
  .option("-y, --yes", "Skip confirmation prompt (--mode replace only)")
  // v0.8.4 — deprecated aliases. Removed in v1.0.
  .option("--merge", "[deprecated] use --mode merge")
  .option("--replace", "[deprecated] use --mode replace")
  .action(async (archive, opts) => {
    const { importCommand } = await import("./import.js");
    await importCommand(archive, opts);
  });

// v0.8.1 §5 — `solosquad archive verify|info|list`
const archiveGroup = program
  .command("archive")
  .description("Inspect a v0.7+ farewell archive (v0.8.1)");

archiveGroup
  .command("verify")
  .description("Verify archive integrity (manifest SHA × actual SHA + schema compat)")
  .argument("<archive>", "Path to archive.zip")
  .option("--json", "Emit a machine-readable verify report")
  .action(async (archive, opts) => {
    const { archiveVerifyCommand } = await import("./archive.js");
    await archiveVerifyCommand(archive, opts);
  });

archiveGroup
  .command("info")
  .description("Show archive metadata + per-class entry counts")
  .argument("<archive>", "Path to archive.zip")
  .action(async (archive) => {
    const { archiveInfoCommand } = await import("./archive.js");
    await archiveInfoCommand(archive);
  });

archiveGroup
  .command("list")
  .description("List manifest entries (filter by --class)")
  .argument("<archive>", "Path to archive.zip")
  .option("--class <cls>", "Restrict to a single class (A, A*, B, C, D)")
  .action(async (archive, opts) => {
    const { archiveListCommand } = await import("./archive.js");
    await archiveListCommand(archive, opts);
  });

// v0.8.4 §7 — `solosquad backup list|delete|purge`
const backupGroup = program
  .command("backup")
  .description("Manage ~/.solosquad-backups/ (v0.8.4)");

backupGroup
  .command("list")
  .description("List all migration backups stored on disk")
  .action(async () => {
    const { backupListCommand } = await import("./backup.js");
    backupListCommand();
  });

backupGroup
  .command("delete")
  .description("Delete a specific backup by id")
  .argument("<id>", "Backup id (e.g. 2026-05-15T03-22-00Z-pre-v0.5)")
  .action(async (id: string) => {
    const { backupDeleteCommand } = await import("./backup.js");
    backupDeleteCommand(id);
  });

backupGroup
  .command("purge")
  .description("Remove backups in bulk (defaults to all unless --keep-recent N)")
  .option(
    "--keep-recent <n>",
    "Keep the N most-recent backups instead of removing everything",
  )
  .option("--dry-run", "Show what would be removed, then exit")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const { backupPurgeCommand } = await import("./backup.js");
    await backupPurgeCommand(opts);
  });
