import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

/**
 * v1.2.8 §A.10 — `solosquad bot --supervise`.
 *
 * Spawns the actual `solosquad bot` (without --supervise) as a child
 * process. When the child exits cleanly (which is what `solosquad
 * migrate --apply` triggers via SIGTERM in v1.2.8), the supervisor
 * waits a short backoff and respawns. The child gets a fresh Node
 * process → fresh module loads → picks up the just-installed code.
 *
 * Loop termination:
 *   - Ctrl+C on the supervisor (`SIGINT`): forwarded to the child,
 *     supervisor exits after the child does.
 *   - Child exits non-zero N times in a row (default 3): supervisor
 *     gives up and exits with the last child's code. Prevents tight
 *     crash loops from hammering the user's machine.
 *
 * Cloud users (PM2 / systemd / Docker) shouldn't use this — their
 * process manager already handles restart. --supervise is purely a
 * local-convenience knob.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRASH_LOOP_THRESHOLD = 3;
const RESPAWN_DELAY_MS = 1500;

export async function runBotSupervisor(): Promise<void> {
  console.log(
    chalk.bold("[Supervisor] solosquad bot --supervise — auto-respawn on clean exit."),
  );
  console.log(
    chalk.dim(
      "  Pairs with `solosquad migrate --apply` (which signals SIGTERM). " +
        "Ctrl+C to stop the supervisor + child.",
    ),
  );

  // CLI entry — walk to repo root then dist/bin/solosquad.js
  // __dirname under dist/ runtime = `<root>/dist/src/cli`
  const cliEntry = path.resolve(
    __dirname,
    "..",
    "..",
    "bin",
    "solosquad.js",
  );

  let crashes = 0;
  let child: ChildProcess | null = null;
  let supervisorShuttingDown = false;

  const stopChild = (sig: NodeJS.Signals): void => {
    if (child && child.pid && !child.killed) {
      try {
        child.kill(sig);
      } catch {
        /* best-effort */
      }
    }
  };

  process.on("SIGINT", () => {
    supervisorShuttingDown = true;
    console.log(
      chalk.yellow("\n[Supervisor] received SIGINT — forwarding to child."),
    );
    stopChild("SIGINT");
  });
  process.on("SIGTERM", () => {
    supervisorShuttingDown = true;
    console.log(
      chalk.yellow("\n[Supervisor] received SIGTERM — forwarding to child."),
    );
    stopChild("SIGTERM");
  });

  while (!supervisorShuttingDown) {
    console.log(chalk.dim(`[Supervisor] spawning solosquad bot (attempt after ${crashes} crash(es))...`));
    const { code, signal } = await runChild(cliEntry, (c) => {
      child = c;
    });
    child = null;

    if (supervisorShuttingDown) {
      // User asked us to stop. Exit with the child's code so process
      // managers (if anyone wraps the supervisor) see the right signal.
      process.exit(code ?? 0);
    }

    if (signal === "SIGTERM" || signal === "SIGINT") {
      // Clean migration-triggered exit. Reset crash counter, respawn.
      console.log(
        chalk.green(
          `[Supervisor] child exited cleanly (signal=${signal}). Respawning in ${RESPAWN_DELAY_MS}ms...`,
        ),
      );
      crashes = 0;
    } else if (code === 0) {
      // Child decided to exit cleanly on its own. Treat as supervisor stop.
      console.log(
        chalk.green(
          "[Supervisor] child exited cleanly (exit code 0). Supervisor stopping.",
        ),
      );
      process.exit(0);
    } else {
      crashes++;
      console.log(
        chalk.red(
          `[Supervisor] child crashed (code=${code} signal=${signal ?? "none"}). ` +
            `Crash count ${crashes}/${CRASH_LOOP_THRESHOLD}.`,
        ),
      );
      if (crashes >= CRASH_LOOP_THRESHOLD) {
        console.log(
          chalk.red(
            `[Supervisor] crash threshold reached — giving up. Last exit code: ${code}.`,
          ),
        );
        process.exit(code ?? 1);
      }
    }

    await sleep(RESPAWN_DELAY_MS);
  }
}

function runChild(
  cliEntry: string,
  onSpawn: (c: ChildProcess) => void,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, "bot"], {
      stdio: "inherit",
      env: process.env,
    });
    onSpawn(child);
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
