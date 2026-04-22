import { Command } from "commander";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Walk up from dist/src/cli/ or src/cli/ to find package.json
let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
if (!fs.existsSync(pkgPath)) {
  pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

export const program = new Command()
  .name("solosquad")
  .version(pkg.version)
  .description("24/7 AI assistant system for solo founders");

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
  .option("--messenger-check", "Validate messenger tokens against live APIs (Slack/Discord/Telegram)")
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
  .command("migrate")
  .description("Migrate workspace to the current SoloSquad version")
  .option("--apply", "Actually apply the migration (default is dry-run)")
  .option("--rollback", "Restore a workspace from a previous backup")
  .option("--list-backups", "List available backups")
  .option("--delete-backup <id>", "Delete a specific backup by id")
  .option("--to <version>", "Target version (default: current CLI version)")
  .action(async (opts) => {
    const { migrateCommand } = await import("./migrate.js");
    await migrateCommand(opts);
  });
