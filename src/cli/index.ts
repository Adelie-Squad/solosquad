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

const LAYOUT_BANNER_SKIP = new Set(["migrate", "update", "doctor", "help"]);

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
  .action(async () => {
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
  .action(async (opts) => {
    const { doctorCommand } = await import("./doctor.js");
    await doctorCommand(opts.ci, opts.messengerCheck);
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

program
  .command("run")
  .description("Autonomous program runner (v0.4 — parser only until v0.3 PM mode lands)")
  .option("--program <prog>", "Program id or path to program.md")
  .option("--hours <n>", "Time budget in hours (overrides program.md)")
  .option("--cycles <n>", "Cycle budget (overrides program.md)")
  .option("--status", "Show active and recent program runs")
  .option("--verify <cycle>", "Re-run evaluator on a past cycle and check determinism")
  .action(async (opts) => {
    const { runCommand } = await import("./run.js");
    await runCommand(opts);
  });

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
  .action(async (input, opts) => {
    const { addRepoCommand } = await import("./add-repo.js");
    await addRepoCommand(input, opts);
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
  .description("Manage PM sessions (v1.3.0+)");

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
  .option("--list-backups", "List available backups")
  .option("--delete-backup <id>", "Delete a specific backup by id")
  .option("--to <version>", "Target version (default: current CLI version)")
  .action(async (opts) => {
    const { migrateCommand } = await import("./migrate.js");
    await migrateCommand(opts);
  });
